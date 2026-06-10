import { NextRequest, NextResponse } from "next/server";
import { getCachedRankingsData } from "@/lib/rankings-cache";

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const mode = searchParams.get("mode") || "all"; // "all" or "global_top"
    const limitVal = parseInt(searchParams.get("limit") || "50");
    const bypassCache = searchParams.get("bypassCache") === "true" || searchParams.get("force") === "true";

    try {
        const data = await getCachedRankingsData(bypassCache);
        return serveProcessedData(data, mode, limitVal);
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
        }, {
            headers: {
                "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
            },
        });
    }

    return NextResponse.json({
        quizAttempts: data.quizAttempts,
        mockAttempts: data.mockAttempts,
        users: data.users,
        quizzes: data.quizzes,
        mockTests: data.mockTests
    }, {
        headers: {
            "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
    });
}
