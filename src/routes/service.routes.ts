import { Router, type Request } from "express";
import { z } from "zod";
import { HttpError } from "../lib/http-error.js";
import { ServiceModel } from "../models/service.model.js";
import {
  denyVendorMarketplace,
  requireAuth,
  requireRole,
  requireUnblockedUser,
} from "../middleware/require-auth.js";
import { Types } from "mongoose";

export const serviceRouter = Router();

function getServiceId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] ?? "" : id;
}

const createServiceSchema = z.object({
  title: z.string().min(3, "Service Name must be at least 3 characters").max(120).optional(),
  serviceName: z.string().min(3, "Service Name must be at least 3 characters").max(120).optional(),
  category: z.string().min(2, "Service Category is required").optional(),
  serviceCategory: z.string().min(2, "Service Category is required").optional(),
  price: z.number().min(0, "Price must be a positive number"),
  pricingUnit: z.string().optional().default("per event"),
  description: z.string().min(10, "Description must be at least 10 characters").max(2000),
  location: z.string().min(2, "Location is required").max(120),
  image: z.string().optional().default(""),
  serviceImage: z.string().optional().default(""),
  images: z.array(z.string()).optional().default([]),
  phone: z.string().optional().default(""),
  email: z.string().optional().default(""),
});

// GET /api/services — Publicly accessible; approved services are listed with active first.
serviceRouter.get("/", denyVendorMarketplace, async (req, res, next) => {
  try {
    const { category, search } = req.query;
    const filter: Record<string, unknown> = { approvalStatus: "approved" };

    if (category && typeof category === "string" && category !== "All") {
      filter.category = category;
    }

    if (search && typeof search === "string" && search.trim()) {
      filter.$or = [
        { title: { $regex: search.trim(), $options: "i" } },
        { description: { $regex: search.trim(), $options: "i" } },
        { location: { $regex: search.trim(), $options: "i" } },
        { category: { $regex: search.trim(), $options: "i" } },
      ];
    }

    const services = await ServiceModel.find(filter)
      .sort({ isAvailable: -1, createdAt: -1 })
      .limit(100)
      .lean();
    res.json(services);
  } catch (error) {
    next(error);
  }
});

// GET /api/services/vendor/me — Only for authenticated vendor to see their own services
serviceRouter.get("/vendor/me", requireAuth, requireRole("vendor"), async (req, res, next) => {
  try {
    const services = await ServiceModel.find({ vendorId: req.auth!.user.id })
      .sort({ createdAt: -1 })
      .lean();
    res.json(services);
  } catch (error) {
    next(error);
  }
});

serviceRouter.get(
  "/:id/manage",
  requireAuth,
  requireRole("vendor"),
  requireUnblockedUser,
  async (req, res, next) => {
    try {
      const id = getServiceId(req);
      if (!Types.ObjectId.isValid(id)) {
        throw new HttpError(404, "Service not found");
      }

      const service = await ServiceModel.findOne({
        _id: id,
        vendorId: req.auth!.user.id,
      }).lean();
      if (!service) throw new HttpError(404, "Service not found");
      res.json(service);
    } catch (error) {
      next(error);
    }
  },
);

// GET /api/services/:id — Publicly accessible for approved services, including inactive ones.
serviceRouter.get("/:id", denyVendorMarketplace, async (req, res, next) => {
  try {
    const id = getServiceId(req);
    if (!Types.ObjectId.isValid(id)) throw new HttpError(404, "Service not found");

    const service = await ServiceModel.findOne({
      _id: id,
      approvalStatus: "approved",
    }).lean();
    if (!service) throw new HttpError(404, "Service not found");
    res.json(service);
  } catch (error) {
    next(error);
  }
});

// POST /api/services — Only for vendor users
serviceRouter.post(
  "/",
  requireAuth,
  requireRole("vendor"),
  requireUnblockedUser,
  async (req, res, next) => {
    try {
      const user = req.auth!.user;

      const input = createServiceSchema.parse(req.body);
      const title = input.serviceName || input.title;
      const category = input.serviceCategory || input.category;
      const image = input.serviceImage || input.image || input.images?.[0] || "";

      if (!title) {
        throw new HttpError(400, "Service Name is required.");
      }
      if (!category) {
        throw new HttpError(400, "Service Category is required.");
      }

      const service = await ServiceModel.create({
        ...input,
        title,
        category,
        image,
        vendorId: user.id,
        vendorName: user.name || "Wedding Vendor",
        vendorEmail: user.email,
      });

      res.status(201).json(service);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid service data", issues: error.issues });
        return;
      }
      next(error);
    }
  },
);

serviceRouter.put(
  "/:id",
  requireAuth,
  requireRole("vendor"),
  requireUnblockedUser,
  async (req, res, next) => {
    try {
      const id = getServiceId(req);
      if (!Types.ObjectId.isValid(id)) throw new HttpError(404, "Service not found");

      const input = createServiceSchema.parse(req.body);
      const title = input.serviceName || input.title;
      const category = input.serviceCategory || input.category;
      const image = input.serviceImage || input.image || input.images?.[0] || "";
      if (!title) throw new HttpError(400, "Service Name is required.");
      if (!category) throw new HttpError(400, "Service Category is required.");

      const service = await ServiceModel.findOneAndUpdate(
        { _id: id, vendorId: req.auth!.user.id },
        {
          $set: {
            title,
            category,
            price: input.price,
            pricingUnit: input.pricingUnit,
            description: input.description,
            location: input.location,
            image,
            images: image ? [image] : [],
            phone: input.phone,
            email: input.email,
            approvalStatus: "pending",
          },
        },
        { new: true, runValidators: true },
      ).lean();

      if (!service) throw new HttpError(404, "Service not found");
      res.json(service);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid service data", issues: error.issues });
        return;
      }
      next(error);
    }
  },
);

serviceRouter.delete(
  "/:id",
  requireAuth,
  requireRole("vendor"),
  requireUnblockedUser,
  async (req, res, next) => {
    try {
      const id = getServiceId(req);
      if (!Types.ObjectId.isValid(id)) throw new HttpError(404, "Service not found");

      const result = await ServiceModel.deleteOne({
        _id: id,
        vendorId: req.auth!.user.id,
      });
      if (!result.deletedCount) throw new HttpError(404, "Service not found");
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

// POST /api/services/seed — Populate initial sample services if collection is empty
serviceRouter.post("/seed", requireAuth, requireRole("admin"), async (_req, res, next) => {
  try {
    const count = await ServiceModel.countDocuments();
    if (count > 0) {
      const existing = await ServiceModel.find().sort({ createdAt: -1 }).limit(10).lean();
      res.json({ message: "Services already exist", count, services: existing });
      return;
    }

    const sampleServices = [
      {
        title: "Royal Candid Wedding Photography & Cinematography",
        category: "Photography & Videography",
        price: 45000,
        pricingUnit: "per event",
        description:
          "Award-winning wedding photography, drone footage, 4K cinematic trailer, traditional video coverage and premium leather photobooks.",
        location: "Dhanmondi, Dhaka",
        image: "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=800&q=80",
        phone: "+880 1711 234567",
        email: "royal.photo@matrimap.com",
        vendorId: "demo-vendor-1",
        vendorName: "Royal Lens Studios",
        vendorEmail: "royal.photo@matrimap.com",
        rating: 4.9,
      },
      {
        title: "The Grand Palace Banquet & Convention Hall",
        category: "Venues & Banquet Halls",
        price: 125000,
        pricingUnit: "per day",
        description:
          "Lavish ballroom capacity of 1,200 guests with central air conditioning, bridal suite, royal chandelier decor, and dedicated VIP parking.",
        location: "Gulshan-2, Dhaka",
        image: "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=800&q=80",
        phone: "+880 1722 345678",
        email: "grand.palace@matrimap.com",
        vendorId: "demo-vendor-2",
        vendorName: "Grand Palace Hospitality",
        vendorEmail: "grand.palace@matrimap.com",
        rating: 5.0,
      },
      {
        title: "Nawab Heritage Authentic Kacchi & Royal Feasts",
        category: "Catering & Feasts",
        price: 850,
        pricingUnit: "per plate",
        description:
          "Specialized in fragrant Basmati Kacchi Biryani, Borhani, Chicken Roast, Jorda, and assorted kebabs crafted with authentic heritage recipes.",
        location: "Old Dhaka & Puran Dhaka",
        image: "https://images.unsplash.com/photo-1555244162-803834f70033?auto=format&fit=crop&w=800&q=80",
        phone: "+880 1733 456789",
        email: "nawab.catering@matrimap.com",
        vendorId: "demo-vendor-3",
        vendorName: "Nawab Heritage Caterers",
        vendorEmail: "nawab.catering@matrimap.com",
        rating: 4.8,
      },
      {
        title: "Noor Bridal Glamour & Mehendi Artistry",
        category: "Makeup & Hair Styling",
        price: 18000,
        pricingUnit: "per event",
        description:
          "HD & Airbrush bridal makeup, dupatta draping, intricate bridal mehendi, and hair styling with imported premium cosmetic brands.",
        location: "Banani, Dhaka",
        image: "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=800&q=80",
        phone: "+880 1744 567890",
        email: "noor.bridal@matrimap.com",
        vendorId: "demo-vendor-4",
        vendorName: "Noor Bridal Studio",
        vendorEmail: "noor.bridal@matrimap.com",
        rating: 4.9,
      },
      {
        title: "Enchanted Fairytale Floral & Stage Decorators",
        category: "Decoration & Floral",
        price: 55000,
        pricingUnit: "per event",
        description:
          "Bespoke stage designs, fresh exotic flower arches, fairy light canopies, royal entryway gates, and themed wedding backdrops.",
        location: "Uttara, Dhaka",
        image: "https://images.unsplash.com/photo-1465495976277-4387d4b0b4c6?auto=format&fit=crop&w=800&q=80",
        phone: "+880 1755 678901",
        email: "enchanted.decor@matrimap.com",
        vendorId: "demo-vendor-5",
        vendorName: "Enchanted Decor BD",
        vendorEmail: "enchanted.decor@matrimap.com",
        rating: 4.7,
      },
      {
        title: "EverAfter Full Wedding Planning & Coordination",
        category: "Wedding Planning & Coordination",
        price: 75000,
        pricingUnit: "package",
        description:
          "End-to-end wedding management: budget tracking, vendor negotiations, timeline coordination, invitation dispatch, and on-day event supervision.",
        location: "Mohakhali DOHS, Dhaka",
        image: "https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=800&q=80",
        phone: "+880 1766 789012",
        email: "everafter.plan@matrimap.com",
        vendorId: "demo-vendor-6",
        vendorName: "EverAfter Events",
        vendorEmail: "everafter.plan@matrimap.com",
        rating: 5.0,
      },
    ];

    const seeded = await ServiceModel.insertMany(sampleServices);
    res.status(201).json({ message: "Seeded initial wedding services", count: seeded.length, services: seeded });
  } catch (error) {
    next(error);
  }
});
