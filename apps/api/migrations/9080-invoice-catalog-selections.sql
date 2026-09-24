-- Optional immutable catalog selection retains copied invoice line facts; later catalog edits do not rewrite drafts.
CREATE OR REPLACE FUNCTION openerp.commercial_invoice_draft_calculate(p_book text,p_content jsonb,p_role text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE v_book openerp.books; v_party openerp.commerce_counterparties; v_counterparty jsonb;
  v_seller jsonb; v_customer jsonb; v_line jsonb; v_article jsonb; v_id text; v_seen text[]:='{}'; v_price numeric;
  v_quantity numeric; v_product numeric; v_calculated numeric; v_base numeric; v_discount numeric; v_charge numeric;
  v_net numeric; v_tax numeric; v_gross numeric; v_source numeric; v_tax_evidence jsonb; v_line_match boolean;
  v_base_total numeric:=0; v_discount_total numeric:=0; v_charge_total numeric:=0; v_net_total numeric:=0;
  v_tax_total numeric:=0; v_gross_total numeric; v_tax_known boolean:=true; v_source_total numeric; v_total_match boolean;
  v_issue date; v_due date; v_field text; v_identity text; v_lines jsonb:='[]';
  v_blockers jsonb:='[{"code":"issuance_not_implemented","lineId":null},{"code":"legal_identity_not_verified","lineId":null},{"code":"tax_profile_not_activated","lineId":null}]';
BEGIN
  IF p_role IS NULL OR p_role NOT IN ('customer','supplier') THEN
    PERFORM openerp.fail('InvalidJournal','Select the customer or supplier commercial draft role.'); END IF;
  PERFORM openerp.commerce_exact_object(p_content,ARRAY['title','counterpartyId','counterpartyRevision','seller','customer',
    'currency','currencyScale','plannedIssueDate','supplyDate','dueDate','paymentTerms','sourceTotalMinor','lines']);
  PERFORM openerp.commerce_text(p_content,'title',200);
  SELECT * INTO STRICT v_book FROM openerp.books b WHERE b.id=p_book;
  IF p_content->>'currency' IS DISTINCT FROM v_book.currency OR p_content->'currencyScale' IS DISTINCT FROM to_jsonb(v_book.currency_scale) THEN
    PERFORM openerp.fail('InvalidJournal','This draft slice requires the exact book currency and scale. Currency conversion is not implemented.');
  END IF;
  v_seller:=openerp.invoice_draft_identity(p_book,p_content->'seller');
  v_customer:=openerp.invoice_draft_identity(p_book,p_content->'customer');
  FOREACH v_identity IN ARRAY ARRAY['seller','customer'] LOOP
    IF p_content->v_identity->>'registrationId' IS NULL OR p_content->v_identity->>'address' IS NULL
      OR p_content->v_identity->>'countryCode' IS NULL THEN
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code',v_identity||'_identity_fields_missing','lineId',NULL));
    END IF;
  END LOOP;
  SELECT * INTO v_party FROM openerp.commerce_counterparties c WHERE c.book_id=p_book
    AND c.id=openerp.commerce_text(p_content,'counterpartyId',128);
  IF NOT FOUND OR v_party.role NOT IN (p_role,'both') THEN
    IF p_role='customer' THEN
      PERFORM openerp.fail('InvalidJournal','Choose an existing customer counterpart in this book.');
    ELSE
      PERFORM openerp.fail('InvalidJournal','Choose an existing supplier counterpart in this book.');
    END IF;
  END IF;
  IF openerp.commerce_text(p_content,'counterpartyRevision',18) IS DISTINCT FROM v_party.current_revision::text THEN
    PERFORM openerp.fail('StaleDependency','Read and explicitly select the current counterpart revision before saving a draft.');
  END IF;
  SELECT r.body INTO STRICT v_counterparty FROM openerp.commerce_counterparty_revisions r
    WHERE r.book_id=p_book AND r.counterparty_id=v_party.id AND r.revision=v_party.current_revision;
  FOREACH v_field IN ARRAY ARRAY['plannedIssueDate','supplyDate','dueDate'] LOOP
    IF p_content->v_field<>'null'::jsonb THEN
      IF jsonb_typeof(p_content->v_field) IS DISTINCT FROM 'string' THEN
        PERFORM openerp.fail('InvalidJournal','Draft dates must be calendar date strings or null.');
      END IF;
      PERFORM openerp.bank_date(p_content->>v_field);
    END IF;
  END LOOP;
  v_issue:=(p_content->>'plannedIssueDate')::date; v_due:=(p_content->>'dueDate')::date;
  IF v_issue IS NOT NULL AND v_due IS NOT NULL AND v_due<v_issue THEN
    PERFORM openerp.fail('InvalidJournal',CASE WHEN p_role='customer'
      THEN 'The proposed due date cannot precede the planned issue date.'
      ELSE 'The due date cannot precede the supplier document date.' END);
  END IF;
  PERFORM openerp.invoice_draft_optional_text(p_content,'paymentTerms',1000);
  IF v_issue IS NULL OR v_due IS NULL OR p_content->>'supplyDate' IS NULL OR p_content->>'paymentTerms' IS NULL THEN
    v_blockers:=v_blockers||'[{"code":"dates_or_terms_missing","lineId":null}]'::jsonb;
  END IF;
  v_source_total:=openerp.invoice_draft_minor(p_content,'sourceTotalMinor',true);
  IF jsonb_typeof(p_content->'lines') IS DISTINCT FROM 'array' THEN
    PERFORM openerp.fail('InvalidJournal','Supply the complete draft line array.');
  END IF;
  IF jsonb_array_length(p_content->'lines') NOT BETWEEN 1 AND 50 THEN
    PERFORM openerp.fail('InvalidJournal','A commercial draft contains 1 to 50 lines. No truncation is supported.');
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_content->'lines') LOOP
    PERFORM openerp.commerce_exact_object(v_line,ARRAY['id','description','quantity','unitPriceMinor','baseMinor','discountMinor',
      'chargeMinor','taxMinor','taxDescription','taxEvidenceId','sourceGrossMinor'] || CASE WHEN v_line ? 'catalogSelection' THEN ARRAY['catalogSelection'] ELSE ARRAY[]::text[] END);
    IF v_line ? 'catalogSelection' THEN
      PERFORM openerp.commerce_exact_object(v_line->'catalogSelection',ARRAY['code','revision','unit']);
      SELECT r.body INTO v_article FROM openerp.catalog_article_revisions r
       WHERE r.book_id=p_book AND r.code=v_line->'catalogSelection'->>'code'
         AND r.revision::text=v_line->'catalogSelection'->>'revision';
      IF NOT FOUND OR v_line->'catalogSelection'->>'unit' IS DISTINCT FROM v_article->>'unit'
        OR v_line->>'description' IS DISTINCT FROM v_article->>'description'
        OR v_line->'unitPriceMinor' IS DISTINCT FROM v_article->'unitPriceMinor'
        OR v_line->'taxDescription' IS DISTINCT FROM v_article->'taxDescription' THEN
        PERFORM openerp.fail('StaleDependency','Selected catalog revision and copied line defaults disagree. Select the exact saved article revision.');
      END IF;
    END IF;
    v_id:=openerp.commerce_text(v_line,'id',128);
    IF v_id !~ '^[a-z][a-z0-9_-]{2,127}$' OR v_id=ANY(v_seen) THEN
      PERFORM openerp.fail('InvalidJournal','Every draft line needs a distinct stable identifier.');
    END IF;
    v_seen:=array_append(v_seen,v_id);
    PERFORM openerp.commerce_text(v_line,'description',200);
    IF jsonb_typeof(v_line->'quantity') IS DISTINCT FROM 'string' OR coalesce(v_line->>'quantity','') !~
      '^([1-9][0-9]{0,11}|(0|[1-9][0-9]{0,11})\.[0-9]{0,5}[1-9])$' THEN
      PERFORM openerp.fail('InvalidJournal','Use a positive canonical decimal quantity: at most 12 integer and 6 fractional digits, without trailing fractional zeros.');
    END IF;
    v_quantity:=(v_line->>'quantity')::numeric;
    v_price:=openerp.invoice_draft_minor(v_line,'unitPriceMinor',true);
    v_base:=openerp.invoice_draft_minor(v_line,'baseMinor');
    v_discount:=openerp.invoice_draft_minor(v_line,'discountMinor');
    v_charge:=openerp.invoice_draft_minor(v_line,'chargeMinor');
    v_tax:=openerp.invoice_draft_minor(v_line,'taxMinor',true);
    v_source:=openerp.invoice_draft_minor(v_line,'sourceGrossMinor',true);
    PERFORM openerp.invoice_draft_optional_text(v_line,'taxDescription',200);
    v_tax_evidence:=NULL;
    IF v_line->'taxEvidenceId'<>'null'::jsonb THEN
      v_tax_evidence:=openerp.commerce_evidence(p_book,openerp.commerce_text(v_line,'taxEvidenceId',128));
    END IF;
    IF v_tax IS NULL OR v_tax_evidence IS NULL OR v_line->>'taxDescription' IS NULL THEN
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','tax_inputs_unreviewed','lineId',v_id));
    END IF;
    IF v_discount>v_base THEN PERFORM openerp.fail('InvalidJournal','A line discount cannot exceed its explicit base. Credit notes are outside this draft slice.'); END IF;
    v_net:=v_base-v_discount+v_charge; v_gross:=v_net+v_tax;
    IF v_net>=1e38::numeric OR v_gross>=1e38::numeric THEN
      PERFORM openerp.fail('InvalidJournal','Each calculated draft line amount must remain below 10^38 minor units.');
    END IF;
    v_product:=v_quantity*v_price; v_calculated:=NULL;
    IF v_product IS NULL OR v_product<>trunc(v_product) THEN
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','quantity_price_not_exact','lineId',v_id));
    ELSE
      v_calculated:=trunc(v_product);
      IF v_calculated<>v_base THEN
        v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','line_base_mismatch','lineId',v_id));
      END IF;
    END IF;
    v_line_match:=CASE WHEN v_gross IS NULL OR v_source IS NULL THEN NULL ELSE v_gross=v_source END;
    IF v_line_match=false THEN
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','line_total_mismatch','lineId',v_id));
    END IF;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('id',v_id,'calculatedBaseMinor',v_calculated::text,
      'netMinor',v_net::text,'grossMinor',v_gross::text,'sourceGrossMatches',v_line_match,'taxEvidence',v_tax_evidence));
    v_base_total:=v_base_total+v_base; v_discount_total:=v_discount_total+v_discount;
    v_charge_total:=v_charge_total+v_charge; v_net_total:=v_net_total+v_net;
    IF v_tax IS NULL THEN v_tax_known:=false; ELSE v_tax_total:=v_tax_total+v_tax; END IF;
  END LOOP;
  IF NOT v_tax_known THEN v_tax_total:=NULL; END IF;
  v_gross_total:=v_net_total+v_tax_total;
  v_total_match:=CASE WHEN v_gross_total IS NULL OR v_source_total IS NULL THEN NULL ELSE v_gross_total=v_source_total END;
  IF v_total_match=false THEN v_blockers:=v_blockers||'[{"code":"document_total_mismatch","lineId":null}]'::jsonb; END IF;
  RETURN jsonb_build_object('counterparty',v_counterparty,'sellerEvidence',v_seller,'customerEvidence',v_customer,
    'totals',jsonb_build_object('baseMinor',v_base_total::text,'discountMinor',v_discount_total::text,'chargeMinor',v_charge_total::text,
      'netMinor',v_net_total::text,'taxMinor',v_tax_total::text,'grossMinor',v_gross_total::text,'sourceTotalMatches',v_total_match),
    'calculatedLines',v_lines,'blockers',v_blockers);
END $$;