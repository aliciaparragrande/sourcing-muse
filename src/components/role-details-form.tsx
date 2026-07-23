import { useId } from "react";

export type RoleDetails = {
  title: string;
  level: string;
  team: string;
  location: string;
  
  must_haves: string;
  nice_to_haves: string;
  context: string;
};

export function emptyRoleDetails(): RoleDetails {
  return {
    title: "",
    level: "",
    team: "",
    location: "",
    must_haves: "",
    nice_to_haves: "",
    context: "",
  };
}

const TEAMS = [
  "Research",
  "Platform/Infra",
  "Data Eng",
  "Security",
  "Product/UX",
  "Growth",
  "SRE",
  "Risk/Fraud",
  "Responsible Gambling",
  "Other",
];

const LEVELS = ["Junior", "Mid", "Senior", "Staff", "Principal", "Lead", "Head of", "Director"];

export function RoleDetailsForm({
  value,
  onChange,
  autofilled,
}: {
  value: RoleDetails;
  onChange: (v: RoleDetails) => void;
  autofilled?: Set<keyof RoleDetails>;
}) {
  const id = useId();
  const set = <K extends keyof RoleDetails>(k: K, v: RoleDetails[K]) =>
    onChange({ ...value, [k]: v });
  const isAuto = (k: keyof RoleDetails) => autofilled?.has(k) ?? false;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Role title" htmlFor={`${id}-title`} required auto={isAuto("title")}>
        <input
          id={`${id}-title`}
          value={value.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="e.g. Senior Backend Engineer, Payments"
          className={inputCls}
        />
      </Field>
      <Field label="Level" htmlFor={`${id}-level`} auto={isAuto("level")}>
        <select
          id={`${id}-level`}
          value={value.level}
          onChange={(e) => set("level", e.target.value)}
          className={inputCls}
        >
          <option value="">Select…</option>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Team" htmlFor={`${id}-team`} auto={isAuto("team")}>
        <select
          id={`${id}-team`}
          value={value.team}
          onChange={(e) => set("team", e.target.value)}
          className={inputCls}
        >
          <option value="">Select…</option>
          {TEAMS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Location / working model" htmlFor={`${id}-loc`} auto={isAuto("location")}>
        <input
          id={`${id}-loc`}
          value={value.location}
          onChange={(e) => set("location", e.target.value)}
          placeholder="London hybrid, 2 days in office"
          className={inputCls}
        />
      </Field>
      <Field
        label="Must-haves"
        htmlFor={`${id}-must`}
        className="md:col-span-2"
        auto={isAuto("must_haves")}
      >
        <textarea
          id={`${id}-must`}
          value={value.must_haves}
          onChange={(e) => set("must_haves", e.target.value)}
          placeholder="Deal-breakers. Skills, experience, ways of working."
          rows={3}
          className={inputCls}
        />
      </Field>
      <Field
        label="Nice-to-haves"
        htmlFor={`${id}-nice`}
        className="md:col-span-2"
        auto={isAuto("nice_to_haves")}
      >
        <textarea
          id={`${id}-nice`}
          value={value.nice_to_haves}
          onChange={(e) => set("nice_to_haves", e.target.value)}
          placeholder="Bonus points, not required."
          rows={2}
          className={inputCls}
        />
      </Field>
      <Field
        label="Context"
        htmlFor={`${id}-ctx`}
        className="md:col-span-2"
        auto={isAuto("context")}
      >
        <textarea
          id={`${id}-ctx`}
          value={value.context}
          onChange={(e) => set("context", e.target.value)}
          placeholder="Why does this role exist? Team dynamics, projects, hiring manager quirks. The stuff a JD leaves out."
          rows={4}
          className={inputCls}
        />
      </Field>
    </div>
  );
}


function Field({
  label,
  htmlFor,
  required,
  className,
  auto,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  className?: string;
  auto?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-1.5">
        <label htmlFor={htmlFor} className="block text-xs font-medium text-foreground">
          {label} {required && <span className="text-destructive">*</span>}
        </label>
        {auto && (
          <span className="inline-flex items-center rounded-sm bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
            from JD
          </span>
        )}
      </div>
      {children}
    </div>
  );
}


const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring";
