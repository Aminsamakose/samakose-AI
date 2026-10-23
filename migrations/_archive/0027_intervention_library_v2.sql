-- Align the intervention library with the eight dimensions of the live SME360 framework.
-- Existing item codes are unchanged, so interventions already created from them stay valid.
-- Idempotent: safe to run more than once. New items are approved as drafted by the administrator.
INSERT INTO "library_items" ("code","title","dimension","description","typical_days","kpi_hint") VALUES
 ('IVL-001','Weekly cash review routine','Financial Management and Performance','Set a weekly cash review with a simple cash book.',30,'Cash cover in weeks'),
 ('IVL-002','Debtor collection routine','Financial Management and Performance','Agree terms, follow up late payers on a fixed rhythm.',45,'Debtor days'),
 ('IVL-003','Costing and pricing sheet','Strategy, Market and Customers','Cost every product line and set prices from cost plus market.',30,'Gross margin percent'),
 ('IVL-004','Buyer diversification plan','Strategy, Market and Customers','Identify and approach five new buyers.',60,'Top buyer share of sales'),
 ('IVL-005','Loss measurement and reduction','Operations and Value Delivery','Measure losses at each stage and fix the largest.',60,'Loss percent'),
 ('IVL-006','Monthly stock count','Operations and Value Delivery','Count and reconcile stock monthly.',30,'Stock variance percent'),
 ('IVL-007','Roles and monthly review','People, Leadership and Governance','Write roles and hold a monthly review.',45,'Reviews held'),
 ('IVL-008','Simple ledger and records','Records, Data and Systems','Set up a ledger for sales and purchases.',30,'Months with complete records'),
 ('IVL-009','Registration and compliance','Legal, Regulatory and Risk','Complete registration and tax filings.',90,'Compliance items complete'),
 ('IVL-010','Investment readiness pack','Funding and Capital Readiness','Prepare records and a summary for lenders.',90,'Pack complete'),
 ('IVL-011','Working capital facility preparation','Funding and Capital Readiness','Prepare a financing request, secure a facility and agree a repayment plan.',180,'Facility secured in GHS'),
 ('IVL-012','Second market development','Strategy, Market and Customers','Open and serve a second market zone or buyer group.',180,'Share of sales from new buyers'),
 ('IVL-013','Storage and handling upgrade','Operations and Value Delivery','Improve storage or handling to cut losses and hold stock for better prices.',180,'Loss percent'),
 ('IVL-014','Annual plan and budget cycle','People, Leadership and Governance','Set a yearly plan and budget with a quarterly review calendar.',360,'Quarterly reviews held'),
 ('IVL-015','Governance and accountability structure','People, Leadership and Governance','Set up an advisory group and written policies for the business.',360,'Policies in force'),
 ('IVL-016','Reviewed annual accounts','Funding and Capital Readiness','Produce a full year of management accounts and prepare for external review.',360,'Months of reviewed accounts'),
 ('IVL-017','Customer and sales record','Records, Data and Systems','Record every sale and customer in one book or sheet so repeat buyers and trends are visible.',30,'Months with sales records kept'),
 ('IVL-018','Document filing and backup routine','Records, Data and Systems','File key documents in one place, keep a copy off site, and name a person responsible.',45,'Key documents filed and backed up'),
 ('IVL-019','Risk register and mitigation plan','Legal, Regulatory and Risk','List the main risks to the business, rate them, and agree an owner and action for each of the top five.',60,'Top risks with an owner and action'),
 ('IVL-020','Key contracts and agreements file','Legal, Regulatory and Risk','Put the main buyer, supplier, lease and employment agreements in writing, signed and filed.',60,'Key agreements written and signed'),
 ('IVL-021','Seasonal and climate risk plan','Resilience, Inclusion and Sustainability','Map the seasonal and weather risks to supply, production and sales, and agree a response for each.',90,'Risks with a response plan'),
 ('IVL-022','Women and youth inclusion practice','Resilience, Inclusion and Sustainability','Review who works in, supplies and buys from the business, and set two practical steps to widen access for women and youth.',90,'Share of women and youth in roles and sales'),
 ('IVL-023','Waste and environmental practice','Resilience, Inclusion and Sustainability','Identify the main waste and environmental impacts and put simple handling practices in place.',90,'Waste managed per agreed practice'),
 ('IVL-024','Monthly budget versus actual','Financial Management and Performance','Compare actual income and costs with the budget every month and act on the largest gaps.',45,'Months reviewed against budget'),
 ('IVL-025','Twelve-month business plan','Strategy, Market and Customers','Write a twelve-month plan with sales and profit targets in cedis and the steps to reach them.',60,'Plan with targets in cedis'),
 ('IVL-026','Staff pay and basic HR records','People, Leadership and Governance','Give every worker written terms, keep pay records, and agree a simple leave and conduct rule.',45,'Staff with written terms and pay records'),
 ('IVL-027','Lender and funder mapping','Funding and Capital Readiness','List suitable lenders and funders, match each to the business, and approach the best three.',45,'Funders matched and approached'),
 ('IVL-028','Process mapping and standard routines','Operations and Value Delivery','Write down the core production and delivery steps and agree who does what, then follow them for a month.',60,'Core routines written and followed')
ON CONFLICT ("code") DO UPDATE SET "dimension" = EXCLUDED."dimension", "updated_at" = now();
