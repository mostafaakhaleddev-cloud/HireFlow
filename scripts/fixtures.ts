// Valid, tiny synthetic PDF. Distinct content makes application-specific file checks meaningful.
export function syntheticPdf(version = "Backend CV v1") {
  const text = `BT /F1 12 Tf 40 750 Td (Synthetic Example Candidate - ${version.replace(/[^a-zA-Z0-9 .-]/g, "")}) Tj 0 -24 Td (Built REST APIs with ASP.NET Core. Synthetic test data only.) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(output));
    output += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    output += String(offset).padStart(10, "0") + " 00000 n \n";
  output += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}
export function syntheticAnalysis(snapshot: {
  required_skills: string[];
  preferred_skills: string[];
}) {
  return {
    candidate: { name: "Synthetic Example Candidate" },
    skills_evidence: [
      ...snapshot.required_skills,
      ...snapshot.preferred_skills,
    ].map((skill) => ({
      skill,
      status:
        skill === "ASP.NET Core"
          ? ("EVIDENCED" as const)
          : ("NOT_EVIDENCED" as const),
      evidence:
        skill === "ASP.NET Core" ? "Built REST APIs with ASP.NET Core" : null,
      source: skill === "ASP.NET Core" ? "cv_page_1" : null,
    })),
    experience_years: { value: null, status: "UNVERIFIED" as const },
    questions_for_hr: [
      "Can you clarify the duration of your commercial experience?",
    ],
    human_review_required: true as const,
  };
}
