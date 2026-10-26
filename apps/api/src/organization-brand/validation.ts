import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const name = z.string().trim().min(1).max(120);
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const description = z.string().trim().max(2000).nullable();
export const organizationInput = z
  .object({ name, slug: slug.optional() })
  .strict();
export const brandInput = z
  .object({ name, slug: slug.optional(), description: description.optional() })
  .strict();
export const brandUpdateInput = z
  .object({ name: name.optional(), description: description.optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException(
      'Invalid fields: name 1–120, slug 1–80 lowercase letters/digits/hyphens, description up to 2000 characters. Ownership and slug updates are not accepted.',
    );
  return result.data;
}
export function nameSlug(value: string, fallback: 'organization' | 'brand') {
  return (
    value
      .toLowerCase()
      .replace(/ı/g, 'i')
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '') || fallback
  );
}
export function brandId(value: string) {
  if (!z.uuid().safeParse(value).success)
    throw new BadRequestException('Brand ID must be a UUID');
  return value;
}
