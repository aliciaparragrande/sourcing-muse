CREATE TABLE public.candidates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brief_id UUID NOT NULL REFERENCES public.briefs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  linkedin_url TEXT,
  github_url TEXT,
  other_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_company_role TEXT,
  recruiter_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_contacted',
  outreach_message TEXT NOT NULL DEFAULT '',
  outreach_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  added_by UUID,
  added_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidates TO authenticated;
GRANT ALL ON public.candidates TO service_role;

ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view candidates"
  ON public.candidates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert candidates"
  ON public.candidates FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can update candidates"
  ON public.candidates FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can delete candidates"
  ON public.candidates FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_candidates_updated_at
  BEFORE UPDATE ON public.candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX candidates_brief_id_idx ON public.candidates(brief_id);