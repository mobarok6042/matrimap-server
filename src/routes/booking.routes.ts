import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../lib/http-error.js";
import { BookingModel } from "../models/booking.model.js";
import { ServiceModel } from "../models/service.model.js";
import { requireAuth, requireUnblockedUser } from "../middleware/require-auth.js";

export const bookingRouter = Router();

const createBookingSchema = z.object({
  serviceId: z.string().min(1, "Service is required"),
  eventDate: z.string().min(1, "Event date is required").max(30),
  eventLocation: z.string().min(2, "Event location is required").max(120),
  message: z.string().max(2000).optional().default(""),
});

// POST /api/bookings — create a booking request. Defaults to "pending".
bookingRouter.post("/", requireAuth, requireUnblockedUser, async (req, res, next) => {
  try {
    const input = createBookingSchema.parse(req.body);
    const user = req.auth!.user;
    const userRole = (user as { role?: string }).role;

    if (userRole !== "customer") {
      throw new HttpError(403, "Only customer accounts can request bookings.");
    }

    const service = await ServiceModel.findOne({
      _id: input.serviceId,
      approvalStatus: "approved",
      isAvailable: { $ne: false },
    }).lean();
    if (!service) throw new HttpError(404, "Service not found");

    const booking = await BookingModel.create({
      serviceId: service._id.toString(),
      serviceTitle: service.title,
      vendorId: service.vendorId,
      vendorName: service.vendorName,
      vendorEmail: service.vendorEmail,
      customerId: user.id,
      customerName: user.name || user.email?.split("@")[0] || "Customer",
      customerEmail: user.email || "",
      eventDate: input.eventDate,
      eventLocation: input.eventLocation,
      message: input.message || "",
      status: "pending",
    });

    res.status(201).json(booking);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid booking", issues: error.issues });
      return;
    }
    next(error);
  }
});

// GET /api/bookings/me — customer booking history (pending/accepted/declined)
bookingRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const bookings = await BookingModel.find({ customerId: req.auth!.user.id })
      .sort({ createdAt: -1 })
      .lean();
    res.json(bookings);
  } catch (error) {
    next(error);
  }
});

// GET /api/bookings/vendor/me — vendor booking requests for their services
bookingRouter.get("/vendor/me", requireAuth, async (req, res, next) => {
  try {
    const userRole = (req.auth?.user as { role?: string } | undefined)?.role;
    if (userRole !== "vendor") {
      throw new HttpError(403, "Only vendor accounts can access bookings.");
    }

    const bookings = await BookingModel.find({ vendorId: req.auth!.user.id })
      .sort({ createdAt: -1 })
      .lean();
    res.json(bookings);
  } catch (error) {
    next(error);
  }
});

// POST /api/bookings/:id/accept — vendor accepts a booking
bookingRouter.post("/:id/accept", requireAuth, async (req, res, next) => {
  try {
    const user = req.auth!.user;
    const userRole = (user as { role?: string } | undefined)?.role;

    if (userRole !== "vendor") {
      throw new HttpError(403, "Only vendor accounts can accept bookings.");
    }

    const booking = await BookingModel.findById(req.params.id).lean();
    if (!booking) throw new HttpError(404, "Booking not found");

    if (booking.vendorId !== user.id) {
      throw new HttpError(403, "You can only respond to bookings for your own services.");
    }

    const updated = await BookingModel.findOneAndUpdate(
      { _id: req.params.id, vendorId: user.id, status: "pending" },
      { status: "accepted" },
      { new: true },
    ).lean();
    if (!updated) throw new HttpError(409, "This booking request has already been answered.");

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// POST /api/bookings/:id/decline — vendor declines a booking
bookingRouter.post("/:id/decline", requireAuth, async (req, res, next) => {
  try {
    const user = req.auth!.user;
    const userRole = (user as { role?: string } | undefined)?.role;

    if (userRole !== "vendor") {
      throw new HttpError(403, "Only vendor accounts can decline bookings.");
    }

    const booking = await BookingModel.findById(req.params.id).lean();
    if (!booking) throw new HttpError(404, "Booking not found");

    if (booking.vendorId !== user.id) {
      throw new HttpError(403, "You can only respond to bookings for your own services.");
    }

    const updated = await BookingModel.findOneAndUpdate(
      { _id: req.params.id, vendorId: user.id, status: "pending" },
      { status: "declined" },
      { new: true },
    ).lean();
    if (!updated) throw new HttpError(409, "This booking request has already been answered.");

    res.json(updated);
  } catch (error) {
    next(error);
  }
});
