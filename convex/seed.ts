import { mutation } from './_generated/server'
import { requireUser } from './lib/authz'
import { writeCompanyId, logAudit } from './lib/tenancy'

export const seedDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    
    // Check if user already has cages
    const existingCages = await ctx.db
      .query('cages')
      .withIndex('by_company', (q) => q.eq('companyId', user.companyId))
      .collect()
    
    if (existingCages.length > 0) {
      throw new Error('Demo data already exists - found existing cages')
    }

    const companyId = await writeCompanyId(user)
    const now = Date.now()
    const today = new Date().toISOString().split('T')[0]
    
    // Create 3 demo cages with different statuses and characteristics
    const demoCages = [
      {
        name: 'Demo Cage A1',
        location: 'North Bay Section A',
        size: 50,
        capacity: 5000,
        dimensions: '10m x 10m x 5m',
        material: 'HDPE',
        installationDate: '2024-01-15',
        stockingDate: '2024-02-01',
        initialCount: 4500,
        currentCount: 4200,
        initialAbw: 15,
        initialBiomass: 67.5,
        initialWeight: 67.5,
        currentWeight: 1890,
        status: 'active' as const,
        notes: 'Demo cage - actively growing batch',
      },
      {
        name: 'Demo Cage B2',
        location: 'East Bay Section B',
        size: 75,
        capacity: 7500,
        dimensions: '12m x 12m x 6m',
        material: 'Steel frame with netting',
        installationDate: '2023-11-20',
        stockingDate: '2024-01-10',
        initialCount: 6800,
        currentCount: 6200,
        initialAbw: 12,
        initialBiomass: 81.6,
        initialWeight: 81.6,
        currentWeight: 3100,
        status: 'active' as const,
        notes: 'Demo cage - ready for harvest soon',
      },
      {
        name: 'Demo Cage C3',
        location: 'South Bay Section C',
        size: 60,
        capacity: 6000,
        dimensions: '11m x 11m x 5m',
        material: 'HDPE',
        installationDate: '2024-03-01',
        status: 'empty' as const,
        notes: 'Demo cage - awaiting new stock',
      },
    ]

    const cageIds = []
    for (const cageData of demoCages) {
      const cageId = await ctx.db.insert('cages', {
        ...cageData,
        companyId,
        createdBy: user._id,
        updatedAt: now,
      })
      cageIds.push(cageId)
    }

    // Create demo feed supplier and feed type
    const supplierId = await ctx.db.insert('feedSuppliers', {
      name: 'Demo Feed Co.',
      abbreviation: 'DFC',
      contactInfo: 'contact@demofeed.com',
      website: 'https://demofeed.com',
      companyId,
      updatedAt: now,
    })

    const feedTypeId = await ctx.db.insert('feedTypes', {
      name: 'Demo Premium Fish Feed',
      description: 'High-quality pellets for optimal growth',
      currentStock: 500,
      minimumStock: 100,
      pricePerKg: 2.5,
      supplierId,
      active: true,
      companyId,
      updatedAt: now,
    })

    // Create some sample daily records for active cages
    const activeCageIds = cageIds.slice(0, 2) // First two cages are active
    
    for (const cageId of activeCageIds) {
      // Create records for the last 7 days
      for (let i = 6; i >= 0; i--) {
        const recordDate = new Date()
        recordDate.setDate(recordDate.getDate() - i)
        const dateStr = recordDate.toISOString().split('T')[0]
        
        const feedAmount = 25 + Math.random() * 10 // 25-35 kg
        const mortality = Math.floor(Math.random() * 3) // 0-2 fish
        
        await ctx.db.insert('dailyRecords', {
          cageId,
          date: dateStr,
          feedAmount: Math.round(feedAmount * 10) / 10,
          feedTypeId,
          feedType: 'Demo Premium Fish Feed',
          feedPrice: 2.5,
          feedCost: Math.round(feedAmount * 2.5 * 100) / 100,
          mortality,
          notes: i === 0 ? 'Latest demo record' : `Demo record from ${i} days ago`,
          companyId,
          createdBy: user._id,
        })
      }
    }

    // Create a sample biweekly record
    const biweeklyId = await ctx.db.insert('biweeklyRecords', {
      cageId: cageIds[0], // First active cage
      date: today,
      batchCode: 'DEMO-2024-001',
      averageBodyWeight: 450,
      totalFishCount: 4200,
      totalWeight: 1890,
      companyId,
      createdBy: user._id,
      updatedAt: now,
    })

    // Create sample biweekly sampling data
    await ctx.db.insert('biweeklySampling', {
      biweeklyRecordId: biweeklyId,
      samplingNumber: 1,
      fishCount: 50,
      totalWeight: 22.5,
      averageBodyWeight: 450,
      createdBy: user._id,
      updatedAt: now,
    })

    // Create a sample stocking history record
    await ctx.db.insert('stockingHistory', {
      cageId: cageIds[0],
      batchNumber: 'DEMO-STOCK-001',
      stockingDate: '2024-02-01',
      fishCount: 4500,
      initialAbw: 15,
      initialBiomass: 67.5,
      sourceLocation: 'Demo Hatchery',
      transferSupervisor: 'Demo Supervisor',
      samplingSupervisor: 'Demo Sampler',
      status: 'approved',
      notes: 'Demo stocking record',
      companyId,
      createdBy: user._id,
      approvedBy: user._id,
      approvedAt: now,
    })

    await logAudit(ctx, {
      actionType: 'seed_demo',
      tableName: 'system',
      newValues: {
        cages_created: cageIds.length,
        suppliers_created: 1,
        feed_types_created: 1,
        daily_records_created: activeCageIds.length * 7,
        biweekly_records_created: 1,
        stocking_records_created: 1,
      },
    })

    return {
      success: true,
      demo_data_created: {
        cages: cageIds.length,
        suppliers: 1,
        feed_types: 1,
        daily_records: activeCageIds.length * 7,
        biweekly_records: 1,
        stocking_records: 1,
      },
      cage_ids: cageIds,
      supplier_id: supplierId,
      feed_type_id: feedTypeId,
    }
  },
})