import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 3600; // cache 1 hour

export interface CourseSection {
  courseCode: string;
  courseName: string;
  instructor: string;
  enrollment: number;
  capacity: number;
  fillPct: number;
  component: string; // LEC, LAB, REC
  meetingDays: string;
  meetingTime: string;
  creditHours: number;
}

export interface CourseGroup {
  courseCode: string;
  courseName: string;
  creditHours: number;
  sections: CourseSection[];
  totalEnrollment: number;
  totalCapacity: number;
  fillPct: number;
  instructors: string[];
}

async function fetchUNCCourses(subject: string, term: string): Promise<CourseGroup[]> {
  const url = `https://reports.unc.edu/class-search/?subject=${encodeURIComponent(subject)}&term=${encodeURIComponent(term)}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; UNC Course Map research tool)",
      Accept: "text/html",
    },
    next: { revalidate: 3600 },
  });

  if (!res.ok) throw new Error(`Failed to fetch UNC courses: ${res.status}`);
  const html = await res.text();

  // Dynamically import cheerio for HTML parsing
  const { load } = await import("cheerio");
  const $ = load(html);

  const courseMap = new Map<string, CourseGroup>();

  // reports.unc.edu renders a table with class sections
  // Each row contains: Course, Section, Component, Days, Time, Instructor, Enrollment/Capacity
  $("table tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 6) return;

    const rawCode = $(cells[0]).text().trim(); // e.g. "COMP 110 - 001"
    const component = $(cells[2]).text().trim(); // LEC / LAB / REC
    const days = $(cells[3]).text().trim();
    const time = $(cells[4]).text().trim();
    const instructor = $(cells[5]).text().trim() || "Staff";
    const enrollText = $(cells[6]).text().trim(); // e.g. "145 / 180"
    const creditText = $(cells[7])?.text().trim() || "3";

    // Parse course code and name from the first cell
    // Typically: "COMP 110\nIntroduction to Programming"
    const codeMatch = rawCode.match(/^([A-Z]+\s+\d+[A-Z]*)/);
    if (!codeMatch) return;
    const courseCode = codeMatch[1].replace(/\s+/, " ");

    const nameEl = $(cells[0]).find(".course-title, span, div").first();
    const courseName =
      nameEl.text().trim() ||
      $(cells[0]).text().replace(courseCode, "").replace(/[-–]\s*\d+/, "").trim() ||
      "Course";

    // Parse enrollment "145 / 180"
    const enrollMatch = enrollText.match(/(\d+)\s*[\/]\s*(\d+)/);
    const enrollment = enrollMatch ? parseInt(enrollMatch[1]) : 0;
    const capacity = enrollMatch ? parseInt(enrollMatch[2]) : 0;
    const fillPct = capacity > 0 ? Math.round((enrollment / capacity) * 100) : 0;

    const creditHours = parseInt(creditText) || 3;

    const section: CourseSection = {
      courseCode,
      courseName: cleanCourseName(courseName),
      instructor: cleanInstructorName(instructor),
      enrollment,
      capacity,
      fillPct,
      component,
      meetingDays: days,
      meetingTime: time,
      creditHours,
    };

    if (!courseMap.has(courseCode)) {
      courseMap.set(courseCode, {
        courseCode,
        courseName: section.courseName,
        creditHours,
        sections: [],
        totalEnrollment: 0,
        totalCapacity: 0,
        fillPct: 0,
        instructors: [],
      });
    }

    const group = courseMap.get(courseCode)!;
    group.sections.push(section);
    group.totalEnrollment += enrollment;
    group.totalCapacity += capacity;

    if (instructor && instructor !== "Staff" && !group.instructors.includes(instructor)) {
      group.instructors.push(cleanInstructorName(instructor));
    }
  });

  // If the table approach yields nothing, try an alternative selector
  // reports.unc.edu may use a different structure
  if (courseMap.size === 0) {
    // Try card/tile layout
    $(".course-section, .section-row, [data-course]").each((_, el) => {
      const text = $(el).text();
      const codeMatch = text.match(/([A-Z]{2,4}\s+\d{3}[A-Z]?)/);
      if (codeMatch) {
        const courseCode = codeMatch[1];
        if (!courseMap.has(courseCode)) {
          courseMap.set(courseCode, {
            courseCode,
            courseName: extractCourseName($, el),
            creditHours: 3,
            sections: [],
            totalEnrollment: 0,
            totalCapacity: 0,
            fillPct: 0,
            instructors: [],
          });
        }
      }
    });
  }

  // Calculate aggregate fill % for each course group
  for (const group of courseMap.values()) {
    group.fillPct =
      group.totalCapacity > 0
        ? Math.round((group.totalEnrollment / group.totalCapacity) * 100)
        : 0;
  }

  return Array.from(courseMap.values()).sort((a, b) =>
    a.courseCode.localeCompare(b.courseCode)
  );
}

function cleanCourseName(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .replace(/^\d+\s*/, "")
    .trim()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function cleanInstructorName(name: string): string {
  // Remove extra whitespace, handle "Last, First" format
  name = name.replace(/\s+/g, " ").trim();
  if (name.includes(",")) {
    const [last, first] = name.split(",").map((s) => s.trim());
    return `${first} ${last}`;
  }
  return name;
}

function extractCourseName($: ReturnType<typeof import("cheerio").load>, el: unknown): string {
  return "Course";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const subject = searchParams.get("subject");
  const term = searchParams.get("term") || "2026 Spring";

  if (!subject) {
    return NextResponse.json({ error: "subject required" }, { status: 400 });
  }

  try {
    const courses = await fetchUNCCourses(subject, term);
    return NextResponse.json({ subject, term, courses, count: courses.length });
  } catch (err) {
    console.error("Course fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch courses", detail: String(err) },
      { status: 500 }
    );
  }
}
