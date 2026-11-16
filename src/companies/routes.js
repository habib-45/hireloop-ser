import { Router } from "express";

import { getReviewsByCompanyId } from "../data/reviews.js";
import { HttpError } from "../lib/http-error.js";
import { paginationMeta } from "../lib/serializers.js";
import { firstValue, parsePagination } from "../lib/validation.js";
import { serializeJobs, toCompanyDetail } from "../services/jobs.js";

async function companyJobs(store, companyId, limit = 20) {
  const result = await store.listJobs({
    status: "published",
    companyId,
    limit,
    sort: "recent",
  });

  return serializeJobs(store, result.items);
}

export function createCompaniesRouter({ store }) {
  const router = Router();

  router.get("/", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const q = firstValue(req.query.q).trim().slice(0, 120);
    const result = await store.listCompanies({ q, skip, limit });
    const companies = await Promise.all(
      result.items.map(async (company) => {
        const companyId = String(company.id ?? company._id);
        const jobsCount = await store.countJobs({
          status: "published",
          companyId,
        });

        return {
          ...toCompanyDetail(company),
          jobsCount,
        };
      })
    );

    res.json({
      companies,
      pagination: paginationMeta({ page, limit, total: result.total }),
    });
  });

  router.get("/:id", async (req, res) => {
    const company = await store.findCompanyById(req.params.id);

    if (!company) {
      throw new HttpError(
        404,
        "COMPANY_NOT_FOUND",
        "That company could not be found."
      );
    }

    const companyId = String(company.id ?? company._id);
    const [jobs, similarResult] = await Promise.all([
      companyJobs(store, companyId),
      store.listCompanies({ limit: 4 }),
    ]);
    const similarCompanies = similarResult.items
      .filter((candidate) => String(candidate.id ?? candidate._id) !== companyId)
      .slice(0, 3)
      .map((candidate) => toCompanyDetail(candidate));

    res.json({
      company: toCompanyDetail(company),
      jobs,
      reviews: getReviewsByCompanyId(companyId),
      similarCompanies,
    });
  });

  router.get("/:id/jobs", async (req, res) => {
    const company = await store.findCompanyById(req.params.id);

    if (!company) {
      throw new HttpError(
        404,
        "COMPANY_NOT_FOUND",
        "That company could not be found."
      );
    }

    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 50,
    });
    const result = await store.listJobs({
      status: "published",
      companyId: String(company.id ?? company._id),
      skip,
      limit,
      sort: "recent",
    });

    res.json({
      jobs: await serializeJobs(store, result.items),
      pagination: paginationMeta({ page, limit, total: result.total }),
    });
  });

  router.get("/:id/reviews", async (req, res) => {
    const company = await store.findCompanyById(req.params.id);

    if (!company) {
      throw new HttpError(
        404,
        "COMPANY_NOT_FOUND",
        "That company could not be found."
      );
    }

    res.json({
      reviews: getReviewsByCompanyId(String(company.id ?? company._id)),
      rating: Number(company.rating ?? 0),
      reviewsCount: Number(company.reviewsCount ?? 0),
    });
  });

  return router;
}
