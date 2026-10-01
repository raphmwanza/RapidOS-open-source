import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware, getAdminFromRequest } from '@/lib/middleware';
import { findCustomerByPhone, normalizeCompanyPhone, upsertCustomerByPhone } from '@/lib/customers/upsert';

// GET - List all customers for agents (authenticated, company-filtered)
export async function GET(request: NextRequest) {
  // Authenticate request
  const authError = await authMiddleware(request);
  if (authError) return authError;

  const admin = getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[AGENTS][CUSTOMERS][GET] Fetching customers for company:', admin.companyId);
    
    const customers = await prisma.customer.findMany({
      where: {
        companyId: admin.companyId // Filter by company
      },
      include: {
        claims: {
          orderBy: { createdAt: 'desc' },
          take: 5 // Get latest 5 claims per customer
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    console.log(`[AGENTS][CUSTOMERS][GET] Found ${customers.length} customers for company ${admin.companyId}`);

    return NextResponse.json({
      success: true,
      customers: customers.map((customer: any) => ({
        id: customer.id,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phoneNumber: customer.phoneNumber,
        email: customer.email,
        isActive: customer.isActive,
        createdAt: customer.createdAt,
        claims: customer.claims.map((claim: any) => ({
          id: claim.id,
          claimNumber: claim.claimNumber,
          status: claim.status,
          type: claim.type,
          description: claim.description,
          incidentDate: claim.incidentDate,
          createdAt: claim.createdAt
        }))
      }))
    });

  } catch (error) {
    console.error('[AGENTS][CUSTOMERS][GET] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch customers' },
      { status: 500 }
    );
  }
}

// POST - Create new customer
export async function POST(request: NextRequest) {
  // Was unauthenticated and created customers in "the first active company".
  const authError = await authMiddleware(request);
  if (authError) return authError;
  const admin = getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    console.log('[AGENTS][CUSTOMERS][POST] Creating new customer');
    
    const {
      firstName,
      lastName,
      phoneNumber,
      email
    } = await request.json();

    console.log('[AGENTS][CUSTOMERS][POST] Request data:', { firstName, lastName, phoneNumber, email });

    // Validate required fields
    if (!firstName || !lastName || !phoneNumber) {
      return NextResponse.json(
        { success: false, error: 'Prénom, nom et téléphone sont requis' },
        { status: 400 }
      );
    }

    // One customer per person per company: numbers are stored in E.164 and an
    // existing customer (any stored format) is returned, completed with the
    // fields it was missing, instead of creating a duplicate.
    const normalizedPhone = await normalizeCompanyPhone(admin.companyId, phoneNumber);
    if (!normalizedPhone) {
      return NextResponse.json(
        { success: false, error: 'Numéro de téléphone invalide : utilisez le format international, ex. +243812345678' },
        { status: 400 }
      );
    }

    const company = await prisma.company.findFirst({
      where: { id: admin.companyId, isActive: true }
    });

    if (!company) {
      console.error('[AGENTS][CUSTOMERS][POST] No active company found');
      return NextResponse.json(
        { success: false, error: 'No active company found' },
        { status: 500 }
      );
    }

    const existed = !!(await findCustomerByPhone(company.id, normalizedPhone));
    const customer = await upsertCustomerByPhone(prisma, {
      companyId: company.id,
      phoneNumber: normalizedPhone,
      profile: { firstName: String(firstName).trim(), lastName: String(lastName).trim(), email: email ? String(email).trim() : null },
    });
    if (existed) console.log('[AGENTS][CUSTOMERS][POST] Existing customer returned for phone:', normalizedPhone);

    console.log('[AGENTS][CUSTOMERS][POST] Customer created successfully:', customer.id);

    return NextResponse.json({
      success: true,
      existing: existed,
      customer: {
        id: customer.id,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phoneNumber: customer.phoneNumber,
        email: customer.email,
        isActive: customer.isActive,
        createdAt: customer.createdAt
      }
    });

  } catch (error) {
    console.error('[AGENTS][CUSTOMERS][POST] Error creating customer:', error);
    return NextResponse.json(
      { success: false, error: 'Erreur lors de la création du client' },
      { status: 500 }
    );
  }
}