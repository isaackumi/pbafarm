-- Create cages table
CREATE TABLE cages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  stocking_date DATE NOT NULL,
  initial_count INTEGER NOT NULL,
  initial_abw NUMERIC(10, 2) NOT NULL,
  initial_biomass NUMERIC(10, 2) NOT NULL,
  source_farm TEXT,
  source_cage TEXT,
  transfer_supervisor TEXT,
  sampling_supervisor TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'harvested')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create daily_records table
CREATE TABLE daily_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cage_id UUID REFERENCES cages(id) NOT NULL,
  date DATE NOT NULL,
  feed_amount NUMERIC(10, 2) NOT NULL,
  feed_type TEXT,
  feed_price NUMERIC(10, 2) NOT NULL,
  feed_cost NUMERIC(10, 2) NOT NULL,
  mortality INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID
);

-- Create biweekly_records table
CREATE TABLE biweekly_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cage_id UUID REFERENCES cages(id) NOT NULL,
  date DATE NOT NULL,
  average_body_weight NUMERIC(10, 2) NOT NULL,
  sample_size INTEGER NOT NULL,
  estimated_biomass NUMERIC(10, 2) NOT NULL,
  days_of_culture INTEGER NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID
);

-- Create harvest_records table
CREATE TABLE harvest_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cage_id UUID REFERENCES cages(id) NOT NULL,
  harvest_date DATE NOT NULL,
  average_body_weight NUMERIC(10, 2) NOT NULL,
  total_weight NUMERIC(10, 2) NOT NULL,
  estimated_count INTEGER NOT NULL,
  fcr NUMERIC(5, 2) NOT NULL,
  size_breakdown JSONB,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID
);

-- Create users and profiles for authentication
CREATE TABLE profiles (
  id UUID REFERENCES auth.users PRIMARY KEY,
  email TEXT UNIQUE,
  full_name TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Set up policies for Row Level Security
ALTER TABLE cages ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE biweekly_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE harvest_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Everyone can read data
CREATE POLICY "Allow public read access" ON cages FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON daily_records FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON biweekly_records FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON harvest_records FOR SELECT USING (true);

-- Only authenticated users can insert data
CREATE POLICY "Allow authenticated insert" ON cages FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated insert" ON daily_records FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated insert" ON biweekly_records FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated insert" ON harvest_records FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Only admins and super_admins can update and delete data
CREATE POLICY "Allow admin update" ON cages FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid() 
    AND (profiles.role = 'admin' OR profiles.role = 'super_admin')
  )
);

CREATE POLICY "Allow admin delete" ON cages FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid() 
    AND (profiles.role = 'admin' OR profiles.role = 'super_admin')
  )
);

-- Set up database functions
CREATE OR REPLACE FUNCTION create_profile_for_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name', 'user');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile when a user signs up
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE create_profile_for_user();



  
