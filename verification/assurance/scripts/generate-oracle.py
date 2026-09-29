#!/usr/bin/env python3
"""Regenerate independently specified fixtures. Review changes; never run to bless production output."""
from pathlib import Path
from fractions import Fraction
import json, hashlib
P=Path(__file__).resolve().parents[1]/'corpus'
# Independently derived rational expectations. Does not import or execute OpenERP.
def rounding(n,d,mode):
    x=Fraction(n,d)
    if mode=='exact':return None if x.denominator!=1 else x.numerator
    if mode=='floor':return n//d
    s=-1 if n<0 else 1;q,r=divmod(abs(n),d)
    if mode=='toward_zero':return s*q
    up=2*r>d or (2*r==d and (mode=='half_up' or q%2==1))
    return s*(q+int(up))
rows=[]
values=[-101,-100,-99,-7,-5,-3,-2,-1,0,1,2,3,5,7,99,100,101,9007199254740993,-9007199254740993,10**60+25,-(10**60+25)]
for n in values:
 for d in [1,2,4,100]:
  for mode in ['exact','floor','toward_zero','half_up','half_even']:
   out=rounding(n,d,mode)
   rows.append({'id':f'ROUND-{len(rows)+1:03}','n':str(n),'d':str(d),'mode':mode,'expected':None if out is None else str(out),'failure': 'UnsupportedRounding' if out is None else None})
(P/'rounding.json').write_text(json.dumps({'provenance':'Independent Python Fraction/division calculation. Synthetic arithmetic, no statutory claims.','cases':rows},indent=2)+'\n')
# Small complete distributions of a rounded proportional credit release.
release=[]
for cap,total in [(0,7),(1,3),(2,3),(13,25),(1250,2500),(9007199254740993,11)]:
 for mode in ['floor','toward_zero','half_up','half_even']:
  used=0
  cuts=[total//3,total//3,total-2*(total//3)]
  for now in cuts:
   before=rounding(cap*used,total,mode)
   after=cap if used+now==total else rounding(cap*(used+now),total,mode)
   release.append({'id':f'RELEASE-{len(release)+1:03}','capacity':str(cap),'basis':str(total),'consumed':str(used),'consume':str(now),'mode':mode,'expected':str(after-before)})
   used+=now
(P/'release.json').write_text(json.dumps({'provenance':'Cumulative independently rounded endpoints; final endpoint is original capacity.','cases':release},indent=2)+'\n')
canon=[
 {'id':'C14N-KEYS','input':'{ "z": 2, "a": "9007199254740993" }','expected':'{"a":"9007199254740993","z":2}'},
 {'id':'C14N-ARRAY','input':'{"x":[3,1,2],"a":true}','expected':'{"a":true,"x":[3,1,2]}'},
 {'id':'C14N-UTF8','input':'{"𐀀":1,"\ue000":2,"z":3}','expected':'{"z":3,"\ue000":2,"𐀀":1}'},
 {'id':'C14N-NO-NFC','input':'{"b":"å","a":"å"}','expected':'{"a":"å","b":"å"}'},
 {'id':'C14N-ESCAPES','input':'{"v":"a\\n\\t\\u0000b","q":"\\\"\\\\"}','expected':'{"q":"\\\"\\\\","v":"a\\n\\t\\u0000b"}'},
 {'id':'C14N-GENERIC-ARRAY','input':'["x",null,false]','expected':'["x",null,false]'},
 {'id':'C14N-SAFE-MAX','input':'{"v":9007199254740991}','expected':'{"v":9007199254740991}'},
]
for row in canon:row['sha256']=hashlib.sha256(row['expected'].encode('utf8')).hexdigest()
(P/'canonical.json').write_text(json.dumps({'provenance':'Manually specified canonical strings and Python hashlib digests. UTF-8 ordering, no normalization.','cases':canon},indent=2,ensure_ascii=False)+'\n')
# API expected outcomes are constants, not calculator output.
(P/'financial-vectors.json').write_text(json.dumps({'scope':'Synthetic expectations for supported arithmetic/profile fixtures, not legal tax data.','vectors':[
 {'id':'PURCHASE-HALF-DEDUCTION','net':'10000','sourceTax':'2500','deductibleTax':'1250','expense':'11250','payable':'12500'},
 {'id':'CREDIT-PARTIAL-THEN-FINAL','originalNet':'100','originalTax':'25','originalDeduction':'13','legs':[{'net':'40','tax':'10','deduction':'5'},{'net':'60','tax':'15','deduction':'8'}]},
 {'id':'PAID-CREDIT','G':'125000','P':'100000','K':'50000','Q':'10000','unpaid':'0','refundPrincipal':'25000','refundDue':'15000'},
 {'id':'FX-VALUATION-THEN-SETTLEMENT','opening':'110000','revalued':'115000','cash':'116000','valuationGain':'5000','settlementGain':'1000'},
 {'id':'SCHEDULE-FINAL-REMAINDER','total':'10000','shares':['3333','3333','3334']},
 {'id':'FALSE-RECONCILIATION','unexplained':['500','-500'],'sum':'0','ready':False},
]},indent=2)+'\n')
print(len(rows),'rounding vectors;',len(release),'release vectors;',len(canon),'canonical vectors')
