-- Migration: Add bi-weekly records and sampling tables
-- Date: 2024-03-20

-- Drop dependent view first
DROP VIEW IF EXISTS active_cages_with_latest_abw;

-- Drop existing tables if they exist
DROP TABLE IF EXISTS biweekly_sampling;
DROP TABLE IF EXISTS biweekly_records;

-- Create bi-weekly records table
CREATE TABLE biweekly_records (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    cage_id UUID REFERENCES cages(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    batch_code VARCHAR(20) NOT NULL UNIQUE,
    average_body_weight DECIMAL(10,2) NOT NULL,
    total_fish_count INTEGER NOT NULL,
    total_weight DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID REFERENCES auth.users(id)
);

-- Create bi-weekly sampling table
CREATE TABLE biweekly_sampling (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    biweekly_record_id UUID REFERENCES biweekly_records(id) ON DELETE CASCADE,
    sampling_number INTEGER NOT NULL,
    fish_count INTEGER NOT NULL,
    total_weight DECIMAL(10,2) NOT NULL,
    average_body_weight DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID REFERENCES auth.users(id)
);

-- Recreate the view
CREATE OR REPLACE VIEW active_cages_with_latest_abw AS
SELECT 
    c.*,
    br.average_body_weight as latest_abw,
    br.date as last_biweekly_date
FROM cages c
LEFT JOIN LATERAL (
    SELECT 
        average_body_weight,
        date
    FROM biweekly_records
    WHERE cage_id = c.id
    ORDER BY date DESC
    LIMIT 1
) br ON true
WHERE c.status = 'active';

-- Enable RLS on biweekly_records
ALTER TABLE biweekly_records ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for biweekly_records
CREATE POLICY "Users can view biweekly records"
    ON biweekly_records FOR SELECT
    USING (auth.uid() IN (
        SELECT user_id FROM user_roles
        WHERE role_id IN (
            SELECT id FROM roles
            WHERE name IN ('admin', 'manager', 'supervisor')
        )
    ));

CREATE POLICY "Users can insert biweekly records"
    ON biweekly_records FOR INSERT
    WITH CHECK (auth.uid() IN (
        SELECT user_id FROM user_roles
        WHERE role_id IN (
            SELECT id FROM roles
            WHERE name IN ('admin', 'manager', 'supervisor')
        )
    ));

CREATE POLICY "Users can update biweekly records"
    ON biweekly_records FOR UPDATE
    USING (auth.uid() IN (
        SELECT user_id FROM user_roles
        WHERE role_id IN (
            SELECT id FROM roles
            WHERE name IN ('admin', 'manager')
        )
    ));

CREATE POLICY "Users can delete biweekly records"
    ON biweekly_records FOR DELETE
    USING (auth.uid() IN (
        SELECT user_id FROM user_roles
        WHERE role_id IN (
            SELECT id FROM roles
            WHERE name IN ('admin', 'manager')
        )
    ));

-- Enable RLS on biweekly_sampling
ALTER TABLE biweekly_sampling ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for biweekly_sampling
CREATE POLICY "Users can view biweekly sampling"
    ON biweekly_sampling FOR SELECT
    USING (auth.uid() IN (
        SELECT user_id FROM user_roles
        WHERE role_id IN (
            SELECT id FROM roles
            WHERE name IN ('admin', 'manager', 'supervisor')
        )
    ));

CREATE POLICY "Users can insert biweekly sampling"
    ON biweekly_sampling FOR INSERT
    WITH CHECK (auth.uid() IN (
        SELECT user_id FROM user_roles
        WHERE role_id IN (
            SELECT id FROM roles
            WHERE name IN ('admin', 'manager', 'supervisor')
        )
    ));

CREATE POLICY "Users can update biweekly sampling"
    ON biweekly_sampling FOR UPDATE
    USING (auth.uid() IN (
        SELECT user_id FROM user_roles
        WHERE role_id IN (
            SELECT id FROM roles
            WHERE name IN ('admin', 'manager')
        )
    ));

CREATE POLICY "Users can delete biweekly sampling"
    ON biweekly_sampling FOR DELETE
    USING (auth.uid() IN (
        SELECT user_id FROM user_roles
        WHERE role_id IN (
            SELECT id FROM roles
            WHERE name IN ('admin', 'manager')
        )
    ));

-- Create indexes for better query performance
CREATE INDEX idx_biweekly_records_cage_id ON biweekly_records(cage_id);
CREATE INDEX idx_biweekly_records_date ON biweekly_records(date);
CREATE INDEX idx_biweekly_records_batch_code ON biweekly_records(batch_code);
CREATE INDEX idx_biweekly_sampling_record_id ON biweekly_sampling(biweekly_record_id);

-- Add comment to tables
COMMENT ON TABLE biweekly_records IS 'Stores bi-weekly ABW records for each cage';
COMMENT ON TABLE biweekly_sampling IS 'Stores individual sampling data for each bi-weekly record'; 