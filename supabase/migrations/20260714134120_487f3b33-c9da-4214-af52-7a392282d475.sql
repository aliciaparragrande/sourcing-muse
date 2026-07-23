
CREATE TABLE public.briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled brief',
  status TEXT NOT NULL DEFAULT 'draft',
  role_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  sharpen JSONB NOT NULL DEFAULT '{}'::jsonb,
  brief JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.briefs TO authenticated;
GRANT ALL ON public.briefs TO service_role;

ALTER TABLE public.briefs ENABLE ROW LEVEL SECURITY;

-- Any authenticated MrQ user can view all briefs (internal tool, "All Briefs" view)
CREATE POLICY "Authenticated can view all briefs" ON public.briefs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Owners can insert briefs" ON public.briefs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners can update own briefs" ON public.briefs
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners or admins can delete briefs" ON public.briefs
  FOR DELETE TO authenticated USING (auth.uid() = owner_id OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_briefs_updated_at
  BEFORE UPDATE ON public.briefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX briefs_owner_idx ON public.briefs(owner_id);
CREATE INDEX briefs_updated_idx ON public.briefs(updated_at DESC);
