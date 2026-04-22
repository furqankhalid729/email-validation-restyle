import type { Route } from "./+types/api.jotform";
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_SERVER,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_KEY,
  },
});

const PINK_VARIANT_ID = "gid://shopify/ProductVariant/49362546458792";
const WHITE_VARIANT_ID = "gid://shopify/ProductVariant/49362546491560";

function parseRequestedUnits(value: unknown): number {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function buildLineItems(requestedUnits: { pink: number; white: number }) {
  const lineItems: { variantId: string; quantity: number }[] = [];

  if (requestedUnits.pink > 0) {
    lineItems.push({
      variantId: PINK_VARIANT_ID,
      quantity: requestedUnits.pink,
    });
  }

  if (requestedUnits.white > 0) {
    lineItems.push({
      variantId: WHITE_VARIANT_ID,
      quantity: requestedUnits.white,
    });
  }

  return lineItems;
}

async function sendEligibleEmail({
  to,
  firstName,
  lastName,
  invoiceUrl,
  draftOrderName,
}: {
  to: string;
  firstName: string;
  lastName: string;
  invoiceUrl?: string;
  draftOrderName?: string;
}) {
  await transporter.sendMail({
    from: `"Your Brand" <${process.env.SMTP_EMAIL}>`,
    to,
    subject: "Your draft order has been created",
    html: `
      <p>Hi ${[firstName, lastName].filter(Boolean).join(" ") || "there"},</p>
      <p>Your request is eligible and your draft order has been created successfully.</p>
      ${draftOrderName ? `<p><strong>Draft Order:</strong> ${draftOrderName}</p>` : ""}
      ${invoiceUrl ? `<p><a href="${invoiceUrl}">Click here to complete your order</a></p>` : ""}
      <p>Thank you.</p>
    `,
  });
}

async function sendNotEligibleEmail({
  to,
  firstName,
  lastName,
}: {
  to: string;
  firstName: string;
  lastName: string;
}) {
  await transporter.sendMail({
    from: `"Your Brand" <${process.env.SMTP_EMAIL}>`,
    to,
    subject: "Regarding your request",
    html: `
      <p>Hi ${[firstName, lastName].filter(Boolean).join(" ") || "there"},</p>
      <p>Thank you for your interest.</p>
      <p>Unfortunately, you are not eligible based on the requested quantity.</p>
      <p>If you have any questions, please reply to this email.</p>
    `,
  });
}

async function sendProcessingFailedEmail({
  to,
  firstName,
  lastName,
}: {
  to: string;
  firstName: string;
  lastName: string;
}) {
  await transporter.sendMail({
    from: `"Your Brand" <${process.env.SMTP_EMAIL}>`,
    to,
    subject: "We received your request",
    html: `
      <p>Hi ${[firstName, lastName].filter(Boolean).join(" ") || "there"},</p>
      <p>We received your request, but we could not process it right now due to a technical issue.</p>
      <p>Please try again later or contact support.</p>
    `,
  });
}

async function createDraftOrder({
  email,
  firstName,
  lastName,
  phone,
  requestedUnits,
}: {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  requestedUnits: { pink: number; white: number };
}) {
  const lineItems = buildLineItems(requestedUnits);

  if (!lineItems.length) {
    return {
      success: false,
      message: "No valid line items found.",
    };
  }

  const mutation = `
    mutation draftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder {
          id
          invoiceUrl
          name
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      email,
      note: `Created from JotForm submission for ${firstName} ${lastName}`.trim(),
      lineItems,
      customAttributes: [
        { key: "First Name", value: firstName },
        { key: "Last Name", value: lastName },
        { key: "Phone", value: phone },
        { key: "Pink Units", value: String(requestedUnits.pink) },
        { key: "White Units", value: String(requestedUnits.white) },
      ],
    },
  };

  const res = await fetch(`https://${process.env.SHOPIFY_STORE_URL}/admin/api/2026-04/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": String(process.env.SHOPIFY_ACCESS_TOKEN),
    },
    body: JSON.stringify({
      query: mutation,
      variables,
    }),
  });

  const result = await res.json();

  if (!res.ok) {
    return {
      success: false,
      message: "Shopify request failed.",
      status: res.status,
      result,
    };
  }

  const payload = result?.data?.draftOrderCreate;

  if (payload?.userErrors?.length) {
    return {
      success: false,
      message: "Draft order userErrors.",
      errors: payload.userErrors,
    };
  }

  if (!payload?.draftOrder?.id) {
    return {
      success: false,
      message: "Draft order was not created.",
      result,
    };
  }

  return {
    success: true,
    draftOrder: payload.draftOrder,
  };
}

export async function action({ request }: Route.ActionArgs) {
  try {
    const formData = await request.formData();
    const entries = Object.fromEntries(formData.entries());

    const rawRequest = typeof entries.rawRequest === "string" ? entries.rawRequest : "{}";
    const parsedRequest = JSON.parse(rawRequest) as Record<string, unknown>;

    const name = (parsedRequest.q6_name ?? {}) as {
      first?: string;
      last?: string;
    };

    const phone = (parsedRequest.q5_phoneNumber ?? {}) as {
      full?: string;
    };

    const requestedUnits = {
      pink: parseRequestedUnits(parsedRequest.q7_typeA),
      white: parseRequestedUnits(parsedRequest.q8_restylaAir),
    };

    const extractedData = {
      firstName: name.first ?? "",
      lastName: name.last ?? "",
      email: typeof parsedRequest.q4_email === "string" ? parsedRequest.q4_email : "",
      phone: phone.full ?? "",
      requestedUnits,
      totalRequestedUnits: requestedUnits.pink + requestedUnits.white,
    };

    console.log("Extracted JotForm data:", extractedData);

    if (!extractedData.email) {
      return Response.json(
        {
          success: false,
          message: "Email is required.",
        },
        { status: 400 }
      );
    }

    if (extractedData.totalRequestedUnits <= 2) {
      const draftOrderResult = await createDraftOrder({
        email: extractedData.email,
        firstName: extractedData.firstName,
        lastName: extractedData.lastName,
        phone: extractedData.phone,
        requestedUnits: extractedData.requestedUnits,
      });

      if (draftOrderResult.success) {
        console.log("Draft order created successfully:", draftOrderResult);
        await sendEligibleEmail({
          to: extractedData.email,
          firstName: extractedData.firstName,
          lastName: extractedData.lastName,
          invoiceUrl: draftOrderResult.draftOrder?.invoiceUrl,
          draftOrderName: draftOrderResult.draftOrder?.name,
        });

        return Response.json({
          success: true,
          eligible: true,
          message: "Draft order created and eligible email sent successfully.",
          data: extractedData,
          draftOrder: draftOrderResult.draftOrder,
        });
      }

      console.error("Draft order creation failed:", draftOrderResult);

      await sendProcessingFailedEmail({
        to: extractedData.email,
        firstName: extractedData.firstName,
        lastName: extractedData.lastName,
      });

      return Response.json(
        {
          success: false,
          eligible: true,
          message: "Draft order creation failed. Processing failed email sent.",
          data: extractedData,
          error: draftOrderResult,
        },
        { status: 500 }
      );
    }

    await sendNotEligibleEmail({
      to: extractedData.email,
      firstName: extractedData.firstName,
      lastName: extractedData.lastName,
    });

    return Response.json({
      success: true,
      eligible: false,
      message: "Customer is not eligible. Not eligible email sent successfully.",
      data: extractedData,
    });
  } catch (error) {
    console.error("JotForm processing error:", error);

    return Response.json(
      {
        success: false,
        message: "Something went wrong while processing the request.",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}