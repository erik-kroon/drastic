-- Parenthesize JSON field extraction before XML text concatenation.
CREATE OR REPLACE FUNCTION openerp.supplier_payment_document(p_preview jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,openerp AS $$
DECLARE v_item jsonb; v_xml text; v_input jsonb:=p_preview->'input'; v_selection jsonb:=p_preview->'selection';
  v_name text; v_number text;
BEGIN
  v_xml:='<?xml version="1.0" encoding="UTF-8"?>'||
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"><CstmrCdtTrfInitn><GrpHdr><MsgId>'||(p_preview->>'id')||
    '</MsgId><CreDtTm>'||(p_preview->>'createdAt')||'</CreDtTm><NbOfTxs>'||(v_selection->>'count')||
    '</NbOfTxs><CtrlSum>'||openerp.supplier_payment_amount(v_selection->>'totalMinor')||'</CtrlSum><InitgPty><Nm>'||
    openerp.supplier_payment_xml(v_input->>'debtorName')||'</Nm></InitgPty></GrpHdr><PmtInf><PmtInfId>'||(p_preview->>'id')||
    '</PmtInfId><PmtMtd>TRF</PmtMtd><NbOfTxs>'||(v_selection->>'count')||'</NbOfTxs><CtrlSum>'||
    openerp.supplier_payment_amount(v_selection->>'totalMinor')||'</CtrlSum>'||
    '<ReqdExctnDt>'||(v_input->>'executionDate')||'</ReqdExctnDt><Dbtr><Nm>'||
    openerp.supplier_payment_xml(v_input->>'debtorName')||'</Nm></Dbtr><DbtrAcct><Id><IBAN>'||(v_input->>'debtorIban')||
    '</IBAN></Id></DbtrAcct><DbtrAgt><FinInstnId><BIC>'||(v_input->>'debtorBic')||
    '</BIC></FinInstnId></DbtrAgt><ChrgBr>SLEV</ChrgBr>';
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_selection->'items') LOOP
    v_name:=openerp.supplier_payment_xml(v_item->>'creditorName');
    v_number:=openerp.supplier_payment_xml(v_item->>'supplierDocumentNumber');
    v_xml:=v_xml||'<CdtTrfTxInf><PmtId><EndToEndId>'||right(v_item->>'invoiceId',32)||'</EndToEndId></PmtId><Amt><InstdAmt Ccy="SEK">'||
      openerp.supplier_payment_amount(v_item->>'amountMinor')||'</InstdAmt></Amt><CdtrAgt><FinInstnId><BIC>'||
      (v_item->>'creditorBic')||'</BIC></FinInstnId></CdtrAgt><Cdtr><Nm>'||v_name||'</Nm></Cdtr>'||
      '<CdtrAcct><Id><IBAN>'||(v_item->>'creditorIban')||'</IBAN></Id></CdtrAcct><RmtInf><Ustrd>'||
      v_number||'</Ustrd></RmtInf></CdtTrfTxInf>';
  END LOOP;
  RETURN v_xml||'</PmtInf></CstmrCdtTrfInitn></Document>';
END $$;
