import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware, getAdminFromRequest } from '@/lib/middleware';
import { MODERATION_ROLES } from '@/lib/users/roles';
import { normalizeCompanyPhone } from '@/lib/customers/upsert';
import { phoneLookupVariants } from '@/lib/phone';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authMiddleware(request);
  if (authError) return authError;

  const admin = getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const customerId = params.id;
    console.log('[AGENTS][CUSTOMERS][PUT] Updating customer:', customerId);
    
    const {
      firstName,
      lastName,
      phoneNumber,
      email,
      isActive
    } = await request.json();

    console.log('[AGENTS][CUSTOMERS][PUT] Update data:', { firstName, lastName, phoneNumber, email, isActive });

    // Validate required fields
    if (!firstName || !lastName || !phoneNumber) {
      return NextResponse.json(
        { success: false, error: 'Prénom, nom et numéro de téléphone sont requis' },
        { status: 400 }
      );
    }

    // Check if customer exists
    const existingCustomer = await prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!existingCustomer || existingCustomer.companyId !== admin.companyId) {
      return NextResponse.json(
        { success: false, error: 'Client non trouvé' },
        { status: 404 }
      );
    }

    const normalizedPhone = await normalizeCompanyPhone(existingCustomer.companyId, phoneNumber);
    if (!normalizedPhone) {
      return NextResponse.json(
        { success: false, error: 'Numéro de téléphone invalide : utilisez le format international, ex. +243812345678' },
        { status: 400 }
      );
    }

    // The number may not belong to another customer of the company (any stored format).
    if (normalizedPhone !== existingCustomer.phoneNumber) {
      const phoneExists = await prisma.customer.findFirst({
        where: {
          phoneNumber: { in: phoneLookupVariants(normalizedPhone) },
          id: { not: customerId },
          companyId: existingCustomer.companyId
        }
      });

      if (phoneExists) {
        return NextResponse.json(
          { success: false, error: 'Ce numéro de téléphone est déjà utilisé par un autre client' },
          { status: 409 }
        );
      }
    }

    // Validate email format if provided
    if (email && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return NextResponse.json(
        { success: false, error: 'Format d\'email invalide' },
        { status: 400 }
      );
    }

    // Update customer
    const updatedCustomer = await prisma.customer.update({
      where: { id: customerId },
      data: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phoneNumber: normalizedPhone,
        email: email && email.trim() ? email.trim() : null,
        isActive: isActive !== undefined ? isActive : existingCustomer.isActive
      }
    });

    console.log('[AGENTS][CUSTOMERS][PUT] Customer updated successfully:', updatedCustomer.id);

    return NextResponse.json({
      success: true,
      customer: {
        id: updatedCustomer.id,
        firstName: updatedCustomer.firstName,
        lastName: updatedCustomer.lastName,
        phoneNumber: updatedCustomer.phoneNumber,
        email: updatedCustomer.email,
        isActive: updatedCustomer.isActive,
        createdAt: updatedCustomer.createdAt,
        updatedAt: updatedCustomer.updatedAt
      }
    });

  } catch (error) {
    console.error('[AGENTS][CUSTOMERS][PUT] Error updating customer:', error);
    return NextResponse.json(
      { success: false, error: 'Erreur lors de la mise à jour du client' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authMiddleware(request, { requiredRole: [...MODERATION_ROLES] });
  if (authError) return authError;

  const admin = getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const customerId = params.id;
    console.log('[AGENTS][CUSTOMERS][DELETE] Deleting customer:', customerId);

    // Check if customer exists
    const existingCustomer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        claims: true
      }
    });

    if (!existingCustomer || existingCustomer.companyId !== admin.companyId) {
      return NextResponse.json(
        { success: false, error: 'Client non trouvé' },
        { status: 404 }
      );
    }

    // Check if customer has claims
    if (existingCustomer.claims.length > 0) {
      return NextResponse.json(
        { success: false, error: 'Impossible de supprimer un client qui a des réclamations' },
        { status: 400 }
      );
    }

    // Delete customer
    await prisma.customer.delete({
      where: { id: customerId }
    });

    console.log('[AGENTS][CUSTOMERS][DELETE] Customer deleted successfully:', customerId);

    return NextResponse.json({
      success: true,
      message: 'Client supprimé avec succès'
    });

  } catch (error) {
    console.error('[AGENTS][CUSTOMERS][DELETE] Error deleting customer:', error);
    return NextResponse.json(
      { success: false, error: 'Erreur lors de la suppression du client' },
      { status: 500 }
    );
  }
}
