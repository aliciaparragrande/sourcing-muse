
-- BRIEFS: restrict SELECT/UPDATE to owner, assignee, or admin
DROP POLICY IF EXISTS "Authenticated can view briefs" ON public.briefs;
DROP POLICY IF EXISTS "Authenticated can update briefs" ON public.briefs;

CREATE POLICY "Owner assignee or admin can view briefs"
  ON public.briefs FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR assigned_to = auth.uid()
    OR private.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "Owner assignee or admin can update briefs"
  ON public.briefs FOR UPDATE TO authenticated
  USING (
    owner_id = auth.uid()
    OR assigned_to = auth.uid()
    OR private.has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR assigned_to = auth.uid()
    OR private.has_role(auth.uid(), 'admin'::app_role)
  );

-- CANDIDATES: scope all operations to team members of the parent brief
DROP POLICY IF EXISTS "Authenticated can view candidates" ON public.candidates;
DROP POLICY IF EXISTS "Authenticated can insert candidates" ON public.candidates;
DROP POLICY IF EXISTS "Authenticated can update candidates" ON public.candidates;
DROP POLICY IF EXISTS "Authenticated can delete candidates" ON public.candidates;

CREATE POLICY "Brief team can view candidates"
  ON public.candidates FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.briefs b
    WHERE b.id = candidates.brief_id
      AND (b.owner_id = auth.uid()
           OR b.assigned_to = auth.uid()
           OR private.has_role(auth.uid(), 'admin'::app_role))
  ));

CREATE POLICY "Brief team can insert candidates"
  ON public.candidates FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.briefs b
    WHERE b.id = candidates.brief_id
      AND (b.owner_id = auth.uid()
           OR b.assigned_to = auth.uid()
           OR private.has_role(auth.uid(), 'admin'::app_role))
  ));

CREATE POLICY "Brief team can update candidates"
  ON public.candidates FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.briefs b
    WHERE b.id = candidates.brief_id
      AND (b.owner_id = auth.uid()
           OR b.assigned_to = auth.uid()
           OR private.has_role(auth.uid(), 'admin'::app_role))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.briefs b
    WHERE b.id = candidates.brief_id
      AND (b.owner_id = auth.uid()
           OR b.assigned_to = auth.uid()
           OR private.has_role(auth.uid(), 'admin'::app_role))
  ));

CREATE POLICY "Brief team can delete candidates"
  ON public.candidates FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.briefs b
    WHERE b.id = candidates.brief_id
      AND (b.owner_id = auth.uid()
           OR b.assigned_to = auth.uid()
           OR private.has_role(auth.uid(), 'admin'::app_role))
  ));

-- PROFILES: hide email column from other users via column-level revoke.
-- Row-level SELECT policy remains so directory (name/avatar) still works.
REVOKE SELECT (email) ON public.profiles FROM authenticated;
