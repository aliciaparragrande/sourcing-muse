
-- 1. Restrict briefs SELECT to owner or admin
DROP POLICY IF EXISTS "Authenticated can view all briefs" ON public.briefs;
CREATE POLICY "Owners and admins can view briefs"
  ON public.briefs FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_id OR public.has_role(auth.uid(), 'admin'::app_role));

-- 2. Restrict profiles SELECT to own row or admin
DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON public.profiles;
CREATE POLICY "Users can view own profile or admins view all"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'::app_role));

-- 3. Move has_role SECURITY DEFINER out of the exposed public API schema
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM public, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;

-- Rewrite existing policies that reference public.has_role to use private.has_role
DROP POLICY IF EXISTS "Owners or admins can delete briefs" ON public.briefs;
CREATE POLICY "Owners or admins can delete briefs"
  ON public.briefs FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_id OR private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Owners and admins can view briefs" ON public.briefs;
CREATE POLICY "Owners and admins can view briefs"
  ON public.briefs FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_id OR private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can view own profile or admins view all" ON public.profiles;
CREATE POLICY "Users can view own profile or admins view all"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

-- Drop the public copy so it is no longer executable from the exposed API schema
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
