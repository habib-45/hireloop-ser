import { toCompanyDetail } from "./jobs.js";

export function userIdOf(user) {
  return String(user.id ?? user._id);
}

/**
 * Returns the company a recruiter owns. Recruiters created by the seed data
 * also have `companyId` on the user; both links are supported.
 */
export async function findOwnedCompany(store, user) {
  const userId = userIdOf(user);

  if (user.companyId) {
    const company = await store.findCompanyById(user.companyId);

    if (company && (!company.ownerId || company.ownerId === userId)) {
      return company;
    }
  }

  return store.findCompanyByOwner(userId);
}

export function serializeCompany(company) {
  return toCompanyDetail(company);
}

export function missingCompanyFields(company) {
  const missing = [];

  if (!company?.name) missing.push("name");
  if (!company?.industry) missing.push("industry");
  if (!company?.location) missing.push("location");
  if (!company?.about || company.about.length < 10) missing.push("about");

  return missing;
}
