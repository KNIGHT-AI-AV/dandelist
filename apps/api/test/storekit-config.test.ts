import { readFileSync } from "node:fs";
import { expect,it } from "vitest";
import { PRODUCTS,PROVISIONAL_PRICES } from "../src/entitlements";
it("local StoreKit fixture has both provisional prices and one shared group with two-week introductory trials",()=>{
  const config=JSON.parse(readFileSync(new URL("../../mobile/test-fixtures/Dandelist.storekit",import.meta.url),"utf8"));
  expect(config.subscriptionGroups).toHaveLength(1);const products=config.subscriptionGroups[0].subscriptions;
  expect(products.map((p:any)=>p.productID).sort()).toEqual(Object.values(PRODUCTS).sort());
  expect(products.map((p:any)=>Math.round(Number(p.displayPrice)*100))).toEqual([PROVISIONAL_PRICES.monthlyUsdCents,PROVISIONAL_PRICES.annualUsdCents]);
  expect(products.every((p:any)=>p.introductoryOffer.paymentMode==="free"&&p.introductoryOffer.subscriptionPeriod==="P2W")).toBe(true);
});
