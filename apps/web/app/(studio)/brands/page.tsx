import {
  currentOrganization,
  currentBrands,
} from '../../../lib/organization-brand';
import { BrandWorkspace } from './workspace';
export default async function Brands() {
  const organization = await currentOrganization();
  const brands = organization ? await currentBrands() : [];
  return (
    <BrandWorkspace initialOrganization={organization} initialBrands={brands} />
  );
}
