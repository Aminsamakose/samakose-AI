/** The intervention library is organised by the eight SME360 dimensions. AgriFood360 and ESO360 name their dimensions differently, so a weak dimension
 *  on those platforms is translated to the library dimension that holds the matching interventions. Unknown names pass through unchanged. */
const MAP: Record<string, string> = {
  // AgriFood360
  'Market Access, Offtake and Traceability': 'Strategy, Market and Customers',
  'Production, Inputs and Post-harvest': 'Operations and Value Delivery',
  'Seasonal Finance and Capital Readiness': 'Funding and Capital Readiness',
  'People, Leadership and Member Governance': 'People, Leadership and Governance',
  'Regulation, Certification and Risk': 'Legal, Regulatory and Risk',
  'Climate, Inclusion and Sustainability': 'Resilience, Inclusion and Sustainability',
  // ESO360
  'Strategy and Programme Design': 'Strategy, Market and Customers',
  'Delivery Operations and Service Quality': 'Operations and Value Delivery',
  'Funding and Financial Sustainability': 'Funding and Capital Readiness',
  'Data, Results and Learning': 'Records, Data and Systems',
  'Legal, Compliance and Risk': 'Legal, Regulatory and Risk',
  'Inclusion, Climate and Ecosystem Contribution': 'Resilience, Inclusion and Sustainability'
};
export const libraryDimension = (d: string) => MAP[d] ?? d;
/** The weakest dimensions in library terms, in order, without repeats. */
export const weakestForLibrary = (dims: { dimension: string; value: number }[], n = 3) =>
  Array.from(new Set([...dims].sort((a, b) => a.value - b.value).map((d) => libraryDimension(d.dimension)))).slice(0, n);
