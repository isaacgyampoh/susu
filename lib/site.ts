/** Brand and deployment values. One place to change them. */
export const SITE = {
  name:      'Abbie Wealth',
  full:      'Abbie Wealth Susu',
  domain:    'abbiewealthsusu.com',
  memberUrl: process.env.NEXT_PUBLIC_MEMBER_URL ?? 'https://my.abbiewealthsusu.com',
  webUrl:    process.env.NEXT_PUBLIC_WEB_URL    ?? 'https://abbiewealthsusu.com',
}
