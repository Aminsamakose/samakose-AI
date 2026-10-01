/**
 * Verified impact data for the public site. Leave arrays empty until a figure, quote or logo has been
 * confirmed and cleared with the people or organisations involved. Empty sections show a labelled placeholder.
 */
export type Result = { value: string; label: string; source: string; asOf: string };
export type Testimonial = { quote: string; name: string; role: string; organisation: string; consentOn: string };
export type PartnerLogo = { name: string; logoSrc: string; url?: string; permissionOn: string };
export type CaseStudy = { slug: string; title: string; summary: string };

export const RESULTS: Result[] = [];
export const TESTIMONIALS: Testimonial[] = [];
export const PARTNERS: PartnerLogo[] = [];
export const CASE_STUDIES: CaseStudy[] = [];
