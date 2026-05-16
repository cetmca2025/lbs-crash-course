import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth-utils";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Simple in-memory rate limiter (per-isolate on CF Workers — resets on cold starts)
const uploadRateLimit = new Map<string, { count: number, lastUpload: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_UPLOADS_PER_WINDOW = 5;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export async function POST(req: NextRequest) {
    try {
        const clientIp = req.headers.get("x-forwarded-for") || "unknown";
        const now = Date.now();
        
        // Basic Rate Limiting
        const ipData = uploadRateLimit.get(clientIp) || { count: 0, lastUpload: now };
        if (now - ipData.lastUpload < RATE_LIMIT_WINDOW) {
            ipData.count++;
        } else {
            ipData.count = 1;
            ipData.lastUpload = now;
        }
        uploadRateLimit.set(clientIp, ipData);

        if (ipData.count > MAX_UPLOADS_PER_WINDOW) {
            return NextResponse.json({ error: "Rate limit exceeded. Try again later." }, { status: 429 });
        }

        const contentType = req.headers.get("content-type") || "";
        if (!contentType.includes("multipart/form-data")) {
            return NextResponse.json({ error: "Invalid Content-Type. Expected multipart/form-data" }, { status: 400 });
        }

        const formData = await req.formData();
        const file = formData.get("file") as File | null;
        const rawSource = req.headers.get("x-upload-source");
        const source = rawSource?.trim().toLowerCase();

        // 1. Unified Security Logic
        if (source === "registration-flow") {
            // Check for registration secret to prevent public upload abuse
            const regSecret = req.headers.get("x-registration-secret");
            const expectedSecret = process.env.NEXT_PUBLIC_REGISTRATION_SECRET || "lbs_mca_registration_2026_secure";
            
            if (!regSecret || regSecret !== expectedSecret) {
                console.error(`[SEC_CRITICAL] Unauthorized Registration Upload Attempt: IP=${clientIp}, Source=${source}`);
                return NextResponse.json({ error: "Access Denied: Invalid Security Context" }, { status: 403 });
            }
        } else if (source === "profile-upgrade" || source === "admin-action") {
            // MUST be authenticated for profile upgrades or admin actions
            const { error } = await verifySession(req);
            if (error) return error;
        } else {
            // Block everything else
            console.error(`[SEC_CRITICAL] Unauthorized Upload Attempt: Source=${source}, IP=${clientIp}`);
            return NextResponse.json({ error: "Access Denied: Invalid Security Context" }, { status: 403 });
        }

        if (!file || !(file instanceof File)) {
            return NextResponse.json({ error: "No valid file provided" }, { status: 400 });
        }

        // 1. Validate File Size
        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json({ error: "File too large (Max 5MB)" }, { status: 400 });
        }

        // 2. Validate File Type
        if (!ALLOWED_TYPES.includes(file.type)) {
            return NextResponse.json({ error: "Invalid file type. Only JPG, PNG, and WEBP allowed." }, { status: 400 });
        }

        // 3. Convert to base64 data URI for Cloudinary upload (edge-compatible, no Node.js Buffer/Streams)
        const arrayBuffer = await file.arrayBuffer();
        const base64Data = arrayBufferToBase64(arrayBuffer);
        const dataUri = `data:${file.type};base64,${base64Data}`;

        const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.CLOUDINARY_API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;
        const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

        if (!cloudName || !apiKey || !apiSecret) {
            return NextResponse.json({ error: "Upload service not configured" }, { status: 500 });
        }

        // Use Cloudinary's unsigned upload with preset, or signed upload via REST API
        const cloudinaryForm = new FormData();
        cloudinaryForm.append("file", dataUri);
        cloudinaryForm.append("folder", "lbs-mca-uploads");
        if (uploadPreset) {
            cloudinaryForm.append("upload_preset", uploadPreset);
        }
        cloudinaryForm.append("api_key", apiKey);

        // Generate signature for signed upload
        const timestamp = Math.floor(Date.now() / 1000).toString();
        cloudinaryForm.append("timestamp", timestamp);

        const signatureString = `folder=lbs-mca-uploads&timestamp=${timestamp}${uploadPreset ? `&upload_preset=${uploadPreset}` : ""}${apiSecret}`;
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest("SHA-1", encoder.encode(signatureString));
        const hashArray = new Uint8Array(hashBuffer);
        const signature = Array.from(hashArray).map(b => b.toString(16).padStart(2, "0")).join("");
        cloudinaryForm.append("signature", signature);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            const cloudinaryResponse = await fetch(
                `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
                {
                    method: "POST",
                    body: cloudinaryForm,
                    signal: controller.signal,
                }
            );

            clearTimeout(timeoutId);

            if (!cloudinaryResponse.ok) {
                const errData = await cloudinaryResponse.json().catch(() => ({}));
                console.error("[Upload API] Cloudinary error:", errData);
                return NextResponse.json({ error: (errData as any)?.error?.message || "Upload failed" }, { status: 500 });
            }

            const result = await cloudinaryResponse.json();
            return NextResponse.json({ secure_url: (result as any).secure_url }, { status: 200 });
        } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError instanceof DOMException && fetchError.name === "AbortError") {
                return NextResponse.json({ error: "Upload timed out. Please try a smaller file or better connection." }, { status: 504 });
            }
            throw fetchError;
        }

    } catch (error: unknown) {
        if (error instanceof TypeError) {
            console.warn("[Upload API] Malformed or invalid form data:", error.message);
            return NextResponse.json({ error: "Invalid form data or Content-Type" }, { status: 400 });
        }
        
        console.error("Backend Upload Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
