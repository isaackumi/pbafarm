-- Migration: Fix biweekly records RLS policies
-- Date: 2024-03-20

-- Drop existing policies for biweekly_records
DROP POLICY IF EXISTS "Users can view biweekly records" ON biweekly_records;
DROP POLICY IF EXISTS "Users can insert biweekly records" ON biweekly_records;
DROP POLICY IF EXISTS "Users can update biweekly records" ON biweekly_records;
DROP POLICY IF EXISTS "Users can delete biweekly records" ON biweekly_records;

-- Create more permissive RLS policies for biweekly_records
-- Allow all authenticated users to view biweekly records
CREATE POLICY "Allow authenticated users to view biweekly records"
    ON biweekly_records FOR SELECT
    USING (auth.role() = 'authenticated');

-- Allow authenticated users to insert biweekly records
CREATE POLICY "Allow authenticated users to insert biweekly records"
    ON biweekly_records FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

-- Allow users to update their own records or if they have admin/manager roles
CREATE POLICY "Allow users to update biweekly records"
    ON biweekly_records FOR UPDATE
    USING (
        auth.role() = 'authenticated' AND (
            created_by = auth.uid() OR
            auth.uid() IN (
                SELECT user_id FROM user_roles
                WHERE role_id IN (
                    SELECT id FROM roles
                    WHERE name IN ('admin', 'manager', 'super_admin')
                )
            )
        )
    );

-- Allow users to delete their own records or if they have admin/manager roles
CREATE POLICY "Allow users to delete biweekly records"
    ON biweekly_records FOR DELETE
    USING (
        auth.role() = 'authenticated' AND (
            created_by = auth.uid() OR
            auth.uid() IN (
                SELECT user_id FROM user_roles
                WHERE role_id IN (
                    SELECT id FROM roles
                    WHERE name IN ('admin', 'manager', 'super_admin')
                )
            )
        )
    );

-- Drop existing policies for biweekly_sampling
DROP POLICY IF EXISTS "Users can view biweekly sampling" ON biweekly_sampling;
DROP POLICY IF EXISTS "Users can insert biweekly sampling" ON biweekly_sampling;
DROP POLICY IF EXISTS "Users can update biweekly sampling" ON biweekly_sampling;
DROP POLICY IF EXISTS "Users can delete biweekly sampling" ON biweekly_sampling;

-- Create more permissive RLS policies for biweekly_sampling
-- Allow all authenticated users to view biweekly sampling
CREATE POLICY "Allow authenticated users to view biweekly sampling"
    ON biweekly_sampling FOR SELECT
    USING (auth.role() = 'authenticated');

-- Allow authenticated users to insert biweekly sampling
CREATE POLICY "Allow authenticated users to insert biweekly sampling"
    ON biweekly_sampling FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

-- Allow users to update their own records or if they have admin/manager roles
CREATE POLICY "Allow users to update biweekly sampling"
    ON biweekly_sampling FOR UPDATE
    USING (
        auth.role() = 'authenticated' AND (
            created_by = auth.uid() OR
            auth.uid() IN (
                SELECT user_id FROM user_roles
                WHERE role_id IN (
                    SELECT id FROM roles
                    WHERE name IN ('admin', 'manager', 'super_admin')
                )
            )
        )
    );

-- Allow users to delete their own records or if they have admin/manager roles
CREATE POLICY "Allow users to delete biweekly sampling"
    ON biweekly_sampling FOR DELETE
    USING (
        auth.role() = 'authenticated' AND (
            created_by = auth.uid() OR
            auth.uid() IN (
                SELECT user_id FROM user_roles
                WHERE role_id IN (
                    SELECT id FROM roles
                    WHERE name IN ('admin', 'manager', 'super_admin')
                )
            )
        )
    ); 