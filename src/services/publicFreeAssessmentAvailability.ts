import { and, desc, eq } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';
import { db, schema } from '@/db/client';

export type PublicFreeAssessmentAvailability = 'available' | 'coming_soon' | 'temporarily_unavailable';

const lookupPublished = unstable_cache(async (orgType: 'AGRIFOOD' | 'ESO') => {
  const [version] = await db().select({ id: schema.frameworkVersions.id })
    .from(schema.frameworkVersions)
    .innerJoin(schema.frameworks, eq(schema.frameworks.id, schema.frameworkVersions.frameworkId))
    .where(and(
      eq(schema.frameworks.orgType, orgType),
      eq(schema.frameworks.purpose, 'free_preliminary'),
      eq(schema.frameworkVersions.status, 'Published')
    ))
    .orderBy(desc(schema.frameworkVersions.version))
    .limit(1);
  return !!version;
}, ['public-free-assessment-availability-v1'], { revalidate: 30 });

/**
 * Public assessment pages fail closed: a draft is shown as coming soon, and a database
 * outage is shown as temporarily unavailable. This prevents collecting a visitor's details
 * when the published question set cannot be served.
 */
export async function publicFreeAssessmentAvailability(orgType: 'AGRIFOOD' | 'ESO'): Promise<PublicFreeAssessmentAvailability> {
  try {
    return await lookupPublished(orgType) ? 'available' : 'coming_soon';
  } catch {
    return 'temporarily_unavailable';
  }
}
