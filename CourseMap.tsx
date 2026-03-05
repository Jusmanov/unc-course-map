"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Map as LeafletMap, CircleMarker } from "leaflet";
import { BUILDINGS, type Building } from "@/lib/buildings";
import type { CourseGroup } from "@/app/api/courses/route";
import type { ProfessorRating } from "@/app/api/rmp/route";

type LayerMode = "fill" | "enrollment" | "size";

interface BuildingData {
  building: Building;
  courses: CourseGroup[];
  rmp: Record<string, ProfessorRating | null>;
  loading: boolean;
  error?: string;
}

function fillColor(pct: number): string {
  if (pct >= 90) return "#b5432a";
  if (pct >= 70) return "#C8963E";
  if (pct >= 50) return "#4B9CD3";
  return "#3a7d44";
}

function fillLabel(pct: number): string {
  if (pct >= 95) return "FULL";
  if (pct >= 80) return "NEARLY FULL";
  if (pct >= 60) return "FILLING";
  return "OPEN";
}

function rmpColor(rating: number): string {
  if (rating >= 4.0) return "#3a7d44";
  if (rating >= 3.0) return "#C8963E";
  return "#b5432a";
}

function StarRating({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  return (
    <span style={{ color: "#C8963E", letterSpacing: "-1px", fontSize: "0.75rem" }}>
      {"★".repeat(full)}
      {half ? "½" : ""}
      {"☆".repeat(5 - full - (half ? 1 : 0))}
    </span>
  );
}

export default function CourseMap() {
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Map<string, CircleMarker>>(new Map());
  const [activeBuilding, setActiveBuilding] = useState<BuildingData | null>(null);
  const [layer, setLayer] = useState<LayerMode>("fill");
  const [search, setSearch] = useState("");
  const [term] = useState("2026 Spring");
  const [loadingBuilding, setLoadingBuilding] = useState<string | null>(null);

  // Initialize Leaflet map
  useEffect(() => {
    if (mapRef.current) return;
    (async () => {
      const L = await import("leaflet");
      const map = L.map("map", {
        center: [35.9108, -79.0510],
        zoom: 16,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;

      // Add markers for each building
      BUILDINGS.forEach((building) => {
        const marker = L.circleMarker([building.lat, building.lng], {
          radius: 10,
          fillColor: "#4B9CD3",
          color: "rgba(255,255,255,0.6)",
          weight: 2,
          opacity: 1,
          fillOpacity: 0.85,
        }).addTo(map);

        marker.bindTooltip(
          `<div class="tt-name">${building.name}</div><div class="tt-sub">${building.tag}</div>`,
          {
            className: "building-tooltip",
            direction: "top",
            offset: [0, -8],
          }
        );

        marker.on("click", () => handleBuildingClick(building));
        markersRef.current.set(building.id, marker);
      });
    })();
  }, []);

  const handleBuildingClick = useCallback(async (building: Building) => {
    setLoadingBuilding(building.id);
    setActiveBuilding({
      building,
      courses: [],
      rmp: {},
      loading: true,
    });

    try {
      // Fetch live courses for each subject taught in this building
      const allCourses: CourseGroup[] = [];
      await Promise.all(
        building.subjects.map(async (subject) => {
          const res = await fetch(
            `/api/courses?subject=${subject}&term=${encodeURIComponent(term)}`
          );
          if (res.ok) {
            const data = await res.json();
            if (data.courses) allCourses.push(...data.courses);
          }
        })
      );

      // Gather unique instructor names for RMP lookup
      const instructorNames = [
        ...new Set(
          allCourses.flatMap((c) => c.instructors).filter((n) => n && n !== "Staff")
        ),
      ].slice(0, 20); // cap at 20 to avoid hammering RMP

      let rmpData: Record<string, ProfessorRating | null> = {};
      if (instructorNames.length > 0) {
        const rmpRes = await fetch(
          `/api/rmp?name=${encodeURIComponent(instructorNames.join(","))}`
        );
        if (rmpRes.ok) {
          const rmpJson = await rmpRes.json();
          rmpData = rmpJson.results || {};
        }
      }

      setActiveBuilding({
        building,
        courses: allCourses,
        rmp: rmpData,
        loading: false,
      });
    } catch (err) {
      setActiveBuilding((prev) =>
        prev ? { ...prev, loading: false, error: "Failed to load courses" } : null
      );
    } finally {
      setLoadingBuilding(null);
    }
  }, [term]);

  // Filter courses by search
  const filteredCourses =
    activeBuilding?.courses.filter((c) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        c.courseCode.toLowerCase().includes(q) ||
        c.courseName.toLowerCase().includes(q) ||
        c.instructors.some((i) => i.toLowerCase().includes(q))
      );
    }) ?? [];

  // Aggregate stats for sidebar header
  const avgFill =
    filteredCourses.length > 0
      ? Math.round(
          filteredCourses.reduce((s, c) => s + c.fillPct, 0) / filteredCourses.length
        )
      : 0;

  const totalEnrollment = filteredCourses.reduce((s, c) => s + c.totalEnrollment, 0);

  // Get best RMP rating for a course
  function getBestRMP(course: CourseGroup): ProfessorRating | null {
    if (!activeBuilding) return null;
    for (const name of course.instructors) {
      const r = activeBuilding.rmp[name];
      if (r && r.numRatings > 0) return r;
    }
    return null;
  }

  return (
    <>
      {/* Header */}
      <header style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000,
        background: "var(--navy)", padding: "0 24px", height: 56,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: "1px solid rgba(75,156,211,0.18)",
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <h1 style={{
            fontFamily: "'DM Serif Display', serif", fontSize: "1.2rem",
            color: "var(--cream)", letterSpacing: "-0.02em",
          }}>
            Carolina Course Intelligence
          </h1>
          <span style={{
            fontFamily: "'DM Mono', monospace", fontSize: "0.6rem",
            color: "var(--carolina-blue)", letterSpacing: "0.14em", textTransform: "uppercase",
          }}>
            UNC Chapel Hill · {term}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["fill", "enrollment", "size"] as LayerMode[]).map((l) => (
            <button
              key={l}
              onClick={() => setLayer(l)}
              style={{
                fontFamily: "'DM Mono', monospace", fontSize: "0.6rem",
                letterSpacing: "0.08em", textTransform: "uppercase",
                padding: "5px 12px", borderRadius: 3,
                border: `1px solid ${layer === l ? "var(--carolina-blue)" : "rgba(75,156,211,0.25)"}`,
                background: layer === l ? "var(--carolina-blue)" : "transparent",
                color: layer === l ? "var(--navy)" : "rgba(245,240,232,0.5)",
                cursor: "pointer", transition: "all 0.15s",
              }}
            >
              {l === "fill" ? "Fill Rate" : l === "enrollment" ? "Enrollment" : "Class Size"}
            </button>
          ))}
        </div>
      </header>

      {/* Search */}
      <div style={{
        position: "fixed", top: 68, left: 16, zIndex: 600, width: 280,
      }}>
        <span style={{
          position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)",
          color: "rgba(245,240,232,0.4)", fontSize: 14, pointerEvents: "none",
        }}>⌕</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search building, course, or instructor…"
          style={{
            width: "100%", padding: "9px 14px 9px 34px",
            borderRadius: 4, border: "1px solid rgba(75,156,211,0.25)",
            background: "rgba(19,41,75,0.82)", backdropFilter: "blur(12px)",
            color: "var(--cream)", fontFamily: "'Instrument Sans', sans-serif",
            fontSize: "0.8rem", outline: "none",
          }}
        />
      </div>

      {/* Map */}
      <div id="map" style={{ position: "fixed", top: 56, left: 0, right: 0, bottom: 0, zIndex: 1 }} />

      {/* Empty state */}
      {!activeBuilding && (
        <div style={{
          position: "fixed", top: 56, left: 0, right: 0, bottom: 0,
          zIndex: 400, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", pointerEvents: "none",
        }}>
          <p style={{
            fontFamily: "'DM Serif Display', serif", fontSize: "1rem",
            color: "rgba(245,240,232,0.2)", fontStyle: "italic",
          }}>
            Click any building to explore live courses
          </p>
          <p style={{
            fontFamily: "'DM Mono', monospace", fontSize: "0.58rem",
            letterSpacing: "0.1em", color: "rgba(245,240,232,0.1)",
            marginTop: 6, textTransform: "uppercase",
          }}>
            Live data · UNC Registrar + RateMyProfessors
          </p>
        </div>
      )}

      {/* Sidebar */}
      <div style={{
        position: "fixed", top: 56, right: 0, width: 380, bottom: 0,
        zIndex: 500, background: "var(--glass)", backdropFilter: "blur(18px)",
        borderLeft: "1px solid rgba(75,156,211,0.15)",
        display: "flex", flexDirection: "column",
        transform: activeBuilding ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
      }}>
        {/* Close */}
        <button
          onClick={() => setActiveBuilding(null)}
          style={{
            position: "absolute", top: 14, right: 14, width: 28, height: 28,
            border: "none", background: "rgba(19,41,75,0.1)", borderRadius: "50%",
            cursor: "pointer", fontSize: 13, color: "var(--ink)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >✕</button>

        {activeBuilding && (
          <>
            {/* Building header */}
            <div style={{ padding: "22px 22px 14px", borderBottom: "1px solid rgba(19,41,75,0.08)" }}>
              <div style={{
                fontFamily: "'DM Mono', monospace", fontSize: "0.58rem",
                letterSpacing: "0.14em", textTransform: "uppercase",
                color: "var(--carolina-blue)", marginBottom: 5,
              }}>
                {activeBuilding.building.tag}
              </div>
              <h2 style={{
                fontFamily: "'DM Serif Display', serif", fontSize: "1.35rem",
                color: "var(--navy)", lineHeight: 1.15, paddingRight: 32,
              }}>
                {activeBuilding.building.name}
              </h2>
              {activeBuilding.building.yearBuilt && (
                <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
                  <span style={{
                    fontFamily: "'DM Mono', monospace", fontSize: "0.6rem",
                    padding: "2px 7px", borderRadius: 2,
                    background: "rgba(19,41,75,0.07)", color: "var(--warm-gray)",
                  }}>
                    Est. {activeBuilding.building.yearBuilt}
                  </span>
                  <span style={{
                    fontFamily: "'DM Mono', monospace", fontSize: "0.6rem",
                    padding: "2px 7px", borderRadius: 2,
                    background: "rgba(19,41,75,0.07)", color: "var(--warm-gray)",
                  }}>
                    {activeBuilding.building.subjects.join(", ")}
                  </span>
                </div>
              )}
            </div>

            {/* Stats row */}
            {!activeBuilding.loading && (
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                gap: 1, background: "rgba(19,41,75,0.07)",
                borderBottom: "1px solid rgba(19,41,75,0.07)",
              }}>
                {[
                  { val: filteredCourses.length, lbl: "Courses" },
                  { val: totalEnrollment.toLocaleString(), lbl: "Enrolled" },
                  { val: `${avgFill}%`, lbl: "Avg Fill" },
                ].map(({ val, lbl }) => (
                  <div key={lbl} style={{
                    background: "var(--glass)", padding: "12px 8px", textAlign: "center",
                  }}>
                    <span style={{
                      fontFamily: "'DM Serif Display', serif", fontSize: "1.35rem",
                      color: "var(--navy)", display: "block",
                    }}>{val}</span>
                    <span style={{
                      fontFamily: "'DM Mono', monospace", fontSize: "0.55rem",
                      letterSpacing: "0.1em", textTransform: "uppercase",
                      color: "var(--warm-gray)", marginTop: 1, display: "block",
                    }}>{lbl}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Course list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
              {activeBuilding.loading ? (
                <div style={{
                  padding: "40px 24px", textAlign: "center",
                  fontFamily: "'DM Mono', monospace", fontSize: "0.65rem",
                  color: "var(--warm-gray)", letterSpacing: "0.1em",
                }}>
                  LOADING LIVE DATA…
                </div>
              ) : activeBuilding.error ? (
                <div style={{
                  padding: "40px 24px", textAlign: "center",
                  fontFamily: "'DM Mono', monospace", fontSize: "0.65rem",
                  color: "var(--danger)",
                }}>
                  {activeBuilding.error}
                  <div style={{ marginTop: 8, fontSize: "0.55rem", color: "var(--warm-gray)" }}>
                    reports.unc.edu may be blocking requests. Try again.
                  </div>
                </div>
              ) : filteredCourses.length === 0 ? (
                <div style={{
                  padding: "40px 24px", textAlign: "center",
                  fontFamily: "'DM Mono', monospace", fontSize: "0.65rem",
                  color: "var(--warm-gray)", letterSpacing: "0.08em",
                }}>
                  NO COURSES FOUND
                  <div style={{ marginTop: 6, fontSize: "0.55rem" }}>
                    Try a different term or check registrar.unc.edu
                  </div>
                </div>
              ) : (
                filteredCourses.map((course) => {
                  const rmp = getBestRMP(course);
                  return (
                    <div
                      key={course.courseCode}
                      style={{
                        padding: "11px 22px",
                        borderBottom: "1px solid rgba(19,41,75,0.06)",
                        cursor: "default",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "rgba(75,156,211,0.05)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                      }
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{
                          fontFamily: "'DM Mono', monospace", fontSize: "0.62rem",
                          letterSpacing: "0.1em", color: "var(--carolina-blue)", marginBottom: 3,
                        }}>
                          {course.courseCode}
                        </div>
                        <span style={{
                          fontFamily: "'DM Mono', monospace", fontSize: "0.55rem",
                          padding: "2px 6px", borderRadius: 2,
                          background: course.fillPct >= 90
                            ? "rgba(181,67,42,0.1)"
                            : course.fillPct >= 70
                            ? "rgba(200,150,62,0.1)"
                            : "rgba(58,125,68,0.1)",
                          color: course.fillPct >= 90
                            ? "var(--danger)"
                            : course.fillPct >= 70
                            ? "var(--warning)"
                            : "var(--success)",
                        }}>
                          {fillLabel(course.fillPct)}
                        </span>
                      </div>

                      <div style={{
                        fontSize: "0.82rem", fontWeight: 500,
                        color: "var(--navy)", lineHeight: 1.3, marginBottom: 5,
                      }}>
                        {course.courseName}
                      </div>

                      {/* Enrollment bar */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                        <div style={{
                          flex: 1, height: 3, background: "rgba(19,41,75,0.1)",
                          borderRadius: 2, overflow: "hidden",
                        }}>
                          <div style={{
                            height: "100%", borderRadius: 2,
                            width: `${Math.min(course.fillPct, 100)}%`,
                            background: fillColor(course.fillPct),
                            transition: "width 0.4s ease",
                          }} />
                        </div>
                        <span style={{
                          fontFamily: "'DM Mono', monospace", fontSize: "0.58rem",
                          color: "var(--warm-gray)", minWidth: 70,
                        }}>
                          {course.totalEnrollment}/{course.totalCapacity} seats
                        </span>
                      </div>

                      {/* Instructors + RMP */}
                      {course.instructors.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{
                            fontFamily: "'DM Mono', monospace", fontSize: "0.6rem",
                            color: "var(--warm-gray)",
                          }}>
                            {course.instructors.slice(0, 2).join(", ")}
                          </span>
                          {rmp && rmp.numRatings > 0 && (
                            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <StarRating rating={rmp.avgRating} />
                              <span style={{
                                fontFamily: "'DM Mono', monospace", fontSize: "0.55rem",
                                color: rmpColor(rmp.avgRating),
                              }}>
                                {rmp.avgRating.toFixed(1)} ({rmp.numRatings})
                              </span>
                            </span>
                          )}
                        </div>
                      )}

                      {/* Sections count */}
                      {course.sections.length > 1 && (
                        <div style={{
                          marginTop: 4,
                          fontFamily: "'DM Mono', monospace", fontSize: "0.55rem",
                          color: "rgba(19,41,75,0.35)",
                        }}>
                          {course.sections.length} sections · {course.creditHours} credit hrs
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer link */}
            <div style={{
              padding: "10px 22px",
              borderTop: "1px solid rgba(19,41,75,0.07)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <a
                href={`https://reports.unc.edu/class-search/?subject=${activeBuilding.building.subjects[0]}&term=${encodeURIComponent(term)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: "'DM Mono', monospace", fontSize: "0.6rem",
                  color: "var(--carolina-blue)", letterSpacing: "0.08em",
                  textDecoration: "none", textTransform: "uppercase",
                }}
              >
                View on UNC Registrar ↗
              </a>
              <span style={{
                fontFamily: "'DM Mono', monospace", fontSize: "0.55rem",
                color: "rgba(19,41,75,0.3)",
              }}>
                Live data
              </span>
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <div style={{
        position: "fixed", bottom: 24, left: 16, zIndex: 600,
        background: "rgba(19,41,75,0.82)", backdropFilter: "blur(12px)",
        border: "1px solid rgba(75,156,211,0.15)", borderRadius: 4,
        padding: "11px 16px",
      }}>
        <div style={{
          fontFamily: "'DM Mono', monospace", fontSize: "0.55rem",
          letterSpacing: "0.12em", textTransform: "uppercase",
          color: "rgba(245,240,232,0.35)", marginBottom: 7,
        }}>
          Fill Rate
        </div>
        {[
          { color: "#3a7d44", label: "Open  (< 50%)" },
          { color: "#4B9CD3", label: "Filling  (50–70%)" },
          { color: "#C8963E", label: "Nearly Full  (70–90%)" },
          { color: "#b5432a", label: "Full  (90%+)" },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <div style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0 }} />
            <span style={{
              fontFamily: "'DM Mono', monospace", fontSize: "0.58rem",
              color: "rgba(245,240,232,0.55)",
            }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Tooltip styles */}
      <style>{`
        .building-tooltip {
          background: rgba(19,41,75,0.95) !important;
          border: 1px solid rgba(75,156,211,0.3) !important;
          border-radius: 4px !important;
          padding: 7px 12px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.35) !important;
        }
        .building-tooltip::before { display: none !important; }
        .tt-name {
          font-family: 'DM Serif Display', serif;
          font-size: 0.85rem;
          color: #F5F0E8;
        }
        .tt-sub {
          font-family: 'DM Mono', monospace;
          font-size: 0.58rem;
          color: #4B9CD3;
          margin-top: 2px;
          letter-spacing: 0.06em;
        }
        input::placeholder { color: rgba(245,240,232,0.3); }
        input:focus { border-color: var(--carolina-blue) !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(19,41,75,0.18); border-radius: 2px; }
      `}</style>
    </>
  );
}
