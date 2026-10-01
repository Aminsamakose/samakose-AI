/** Single place for public-site facts. Contact details are Samakose's own; everything else is labelled where unverified. */
export const SITE = {
  name: 'Samakose',
  tagline: 'The Business Doctor',
  email: 'info@samakose.com',
  phone: '+233 (0) 55-858-9254',
  phoneHref: '+233558589254',
  web: 'www.samakose.com',
  address: ['Jisonaayili Road, Ayana Junction', 'NS-123-6647, Tamale', 'Northern Region, Ghana']
};

/** Flip to '/register' when self-registration ships (Stage 5). */
export const REGISTER_HREF = '/register';
export const LOGIN_HREF = '/login';
export const PORTAL_HREF = '/dashboard';

export type NavItem = { label: string; href: string };
/** Only live destinations appear here. Pages are added as each stage ships. */
export const NAV: NavItem[] = [
  { label: 'Platform', href: '/platform' },
  { label: 'Solutions', href: '/solutions' },
  { label: 'Impact', href: '/impact' },
  { label: 'Resources', href: '/resources' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' }
];
