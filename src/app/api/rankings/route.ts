import { NextRequest, NextResponse } from "next/server";
import { adminFirestore } from "@/lib/firebase-admin";

// Global in-memory cache
let cachedData: any = null;
let cacheTime = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes cache
const MIN_REVALIDATE_INTERVAL = 60 * 1000; // 1 minute minimum between bypass revalidations

export async function GET(req: NextRequest) {
    if (!adminFirestore) {
        return NextResponse.json({ error: "Database connection failed" }, { status: 500 });
    }

    const searchParams = req.nextUrl.searchParams;
    const mode = searchParams.get("mode") || "all"; // "all" or "global_top"
    const limitVal = parseInt(searchParams.get("limit") || "50");
    const bypassCache = searchParams.get("bypassCache") === "true" || searchParams.get("force") === "true";

    const now = Date.now();
    const canUseCache = cachedData && (!bypassCache || (now - cacheTime < MIN_REVALIDATE_INTERVAL));

    if (canUseCache && (now - cacheTime < CACHE_TTL)) {
        return serveProcessedData(cachedData, mode, limitVal);
    }

    try {
        const [quizzesSnap, mocksSnap, quizAttsSnap, mockAttsSnap] = await Promise.all([
            adminFirestore.collection("quizzes").get(),
            adminFirestore.collection("mockTests").get(),
            adminFirestore.collection("quizAttempts").get(),
            adminFirestore.collection("mockAttempts").get(),
        ]);

        // Helper to process tests — strip questions to save bandwidth
        const processTests = (snap: FirebaseFirestore.QuerySnapshot) => {
            const processed: Record<string, any> = {};
            snap.docs.forEach(doc => {
                const val = doc.data();
                processed[doc.id] = { 
                    id: doc.id, 
                    title: val.title, 
                    subject: val.subject,
                    status: val.status 
                };
            });
            return processed;
        };

        const quizzes = processTests(quizzesSnap);
        const mockTests = processTests(mocksSnap);

        // Process attempts: Only keep fields needed for rankings
        const processAttempts = (snap: FirebaseFirestore.QuerySnapshot) => {
            return snap.docs.map(doc => {
                const val = doc.data();
                return {
                    id: doc.id,
                    userId: val.userId,
                    userName: val.userName,
                    score: Number(val.score) || 0,
                    totalQuestions: Number(val.totalQuestions) || 0,
                    submittedAt: Number(val.submittedAt) || 0,
                    quizId: val.quizId,
                    mockTestId: val.mockTestId
                };
            });
        };

        // Limit attempts to prevent memory issues with large datasets
        const MAX_ATTEMPTS = 5000; // Hard cap to prevent memory bloat
        const quizAttempts = processAttempts(quizAttsSnap).slice(0, MAX_ATTEMPTS);
        const mockAttempts = processAttempts(mockAttsSnap).slice(0, MAX_ATTEMPTS);

        // Build users map from attempts to avoid loading the entire users collection
        const users: Record<string, any> = {};
        const populateUsers = (attempts: any[]) => {
            attempts.forEach(a => {
                if (a.userId && !users[a.userId]) {
                    users[a.userId] = {
                        id: a.userId,
                        name: a.userName || "Student"
                    };
                }
            });
        };
        populateUsers(quizAttempts);
        populateUsers(mockAttempts);

        // Update global cache
        cachedData = {
            quizAttempts,
            mockAttempts,
            users,
            quizzes,
            mockTests
        };
        cacheTime = Date.now();

        return serveProcessedData(cachedData, mode, limitVal);
    } catch (error: any) {
        console.error("Rankings API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

function serveProcessedData(data: any, mode: string, limitVal: number) {
    if (mode === "global_top") {
        return NextResponse.json({
            quizAttempts: data.quizAttempts.slice(0, limitVal),
            mockAttempts: data.mockAttempts.slice(0, limitVal),
            users: data.users,
            quizzes: data.quizzes,
            mockTests: data.mockTests,
            isPartial: true
        });
    }

    return NextResponse.json({
        quizAttempts: data.quizAttempts,
        mockAttempts: data.mockAttempts,
        users: data.users,
        quizzes: data.quizzes,
        mockTests: data.mockTests
    });
}
