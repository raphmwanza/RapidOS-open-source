import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware, getAdminFromRequest } from '@/lib/middleware';

// GET - Get comprehensive claim data
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; claimNumber: string } }
) {
  try {
    // Active account, current token version; read-only roles cannot write.
    const authError = await authMiddleware(request);
    if (authError) return authError;
    const admin = getAdminFromRequest(request)!;

    const { claimNumber } = params;

    // Fetch comprehensive claim data
    const claim = await prisma.claim.findFirst({
      where: {
        claimNumber: claimNumber,
        companyId: admin.companyId
      },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
            email: true
          }
        },
        assignedAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        autoClaimData: true,
        // Metadata only: the bytes are served by /api/documents/[claimId]/[documentId].
        documents: {
          select: { id: true, claimId: true, fileName: true, fileType: true, fileSize: true, uploadedBy: true, createdAt: true },
          orderBy: { createdAt: 'desc' }
        },
        claimNotes: {
          include: {
            author: {
              select: {
                id: true,
                firstName: true,
                lastName: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        statusHistory: {
          orderBy: { changedAt: 'desc' }
        }
      }
    });

    if (!claim) {
      return NextResponse.json(
        { success: false, error: 'Claim not found' },
        { status: 404 }
      );
    }

    // Format the response
    const formattedClaim = {
      id: claim.id,
      claimNumber: claim.claimNumber,
      type: claim.type,
      status: claim.status,
      description: claim.description,
      estimatedAmount: claim.estimatedAmount,
      approvedAmount: claim.approvedAmount,
      incidentDate: claim.incidentDate ? claim.incidentDate.toISOString() : null,
      incidentTime: claim.incidentTime,
      createdAt: claim.createdAt.toISOString(),
      updatedAt: claim.updatedAt.toISOString(),
      approvedAt: claim.approvedAt?.toISOString(),
      rejectedAt: claim.rejectedAt?.toISOString(),
      completedAt: claim.completedAt?.toISOString(),
      customer: claim.customer,
      assignedAdmin: claim.assignedAdmin,
      autoClaimData: claim.autoClaimData ? {
        ...claim.autoClaimData,
        birthDate: claim.autoClaimData.birthDate?.toISOString(),
        createdAt: claim.autoClaimData.createdAt.toISOString(),
        updatedAt: claim.autoClaimData.updatedAt.toISOString()
      } : null,
      documents: claim.documents.map((doc: any) => ({
        ...doc,
        filePath: `/api/documents/${doc.claimId}/${doc.id}`,
        createdAt: doc.createdAt.toISOString()
      })),
      claimNotes: claim.claimNotes.map((note: any) => ({
        ...note,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString()
      })),
      statusHistory: claim.statusHistory.map((history: any) => ({
        ...history,
        changedAt: history.changedAt.toISOString()
      }))
    };

    return NextResponse.json({
      success: true,
      claim: formattedClaim
    });

  } catch (error) {
    console.error('Error fetching claim details:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT - Update claim details and/or auto claim data
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; claimNumber: string } }
) {
  try {
    // Active account, current token version; read-only roles cannot write.
    const authError = await authMiddleware(request);
    if (authError) return authError;
    const admin = getAdminFromRequest(request)!;

    const { claimNumber } = params;
    const body = await request.json().catch(() => ({}));

    // Find the claim within company
    const existing = await prisma.claim.findFirst({
      where: { claimNumber, companyId: admin.companyId },
      include: { autoClaimData: true }
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Claim not found' },
        { status: 404 }
      );
    }

    // Prepare Claim update
    const claimUpdateData: any = {};

    if (typeof body.description === 'string') {
      claimUpdateData.description = body.description;
    }
    if (typeof body.notes === 'string') {
      claimUpdateData.notes = body.notes;
    }
    if (typeof body.estimatedAmount === 'number') {
      claimUpdateData.estimatedAmount = body.estimatedAmount;
    }
    if (typeof body.approvedAmount === 'number') {
      claimUpdateData.approvedAmount = body.approvedAmount;
    }
    if (typeof body.incidentTime === 'string') {
      claimUpdateData.incidentTime = body.incidentTime;
    }
    if (typeof body.incidentDate === 'string' && body.incidentDate) {
      const d = new Date(body.incidentDate);
      if (!isNaN(d.getTime())) {
        claimUpdateData.incidentDate = d;
      }
    }

    // Prepare AutoClaimData update (optional)
    const autoBody = body.autoClaimData || body.autoClaimDataUpdates || {};
    const hasAutoInput = autoBody && typeof autoBody === 'object' && Object.keys(autoBody).length > 0;
    const autoUpdateData: any = {};

    const toBoolString = (v: any) => (typeof v === 'boolean' ? (v ? 'true' : 'false') : undefined);

    const scalarMappings: Record<string, (val: any) => any> = {
      policyNumber: (v) => (typeof v === 'string' ? v : undefined),
      insuredFullName: (v) => (typeof v === 'string' ? v : undefined),
      phoneNumber: (v) => (typeof v === 'string' ? v : undefined),
      address: (v) => (typeof v === 'string' ? v : undefined),
      email: (v) => (typeof v === 'string' ? v : undefined),
      licenseNumber: (v) => (typeof v === 'string' ? v : undefined),
      vehicleMakeModel: (v) => (typeof v === 'string' ? v : undefined),
      vehicleYear: (v) => (typeof v === 'number' ? v : undefined),
      vehicleRegistration: (v) => (typeof v === 'string' ? v : undefined),
      vehicleVin: (v) => (typeof v === 'string' ? v : undefined),
      incidentLocation: (v) => (typeof v === 'string' ? v : undefined),
      roadType: (v) => (typeof v === 'string' ? v : undefined),
      otherDriverName: (v) => (typeof v === 'string' ? v : undefined),
      otherDriverPhone: (v) => (typeof v === 'string' ? v : undefined),
      otherInsuranceCompany: (v) => (typeof v === 'string' ? v : undefined),
      otherPolicyNumber: (v) => (typeof v === 'string' ? v : undefined),
      otherVehicleRegistration: (v) => (typeof v === 'string' ? v : undefined),
      witnessName: (v) => (typeof v === 'string' ? v : undefined),
      witnessPhone: (v) => (typeof v === 'string' ? v : undefined),
      policeReportNumber: (v) => (typeof v === 'string' ? v : undefined),
      damageDescription: (v) => (typeof v === 'string' ? v : undefined),
      estimatedRepairCost: (v) => (typeof v === 'number' || typeof v === 'string' ? String(v) : undefined),
      injuryDescription: (v) => (typeof v === 'string' ? v : undefined),
      additionalNotes: (v) => (typeof v === 'string' ? v : undefined),
      totalPhotosUploaded: (v) => (typeof v === 'number' ? v : undefined),
    };

    if (typeof autoBody.birthDate === 'string' && autoBody.birthDate) {
      const bd = new Date(autoBody.birthDate);
      if (!isNaN(bd.getTime())) {
        autoUpdateData.birthDate = bd;
      }
    }

    // Boolean-like fields are strings in schema
    const policeContactedStr = toBoolString(autoBody.policeContacted);
    if (policeContactedStr !== undefined) autoUpdateData.policeContacted = policeContactedStr;
    const injuriesOccurredStr = toBoolString(autoBody.injuriesOccurred);
    if (injuriesOccurredStr !== undefined) autoUpdateData.injuriesOccurred = injuriesOccurredStr;
    const medicalTreatmentRequiredStr = toBoolString(autoBody.medicalTreatmentRequired);
    if (medicalTreatmentRequiredStr !== undefined) autoUpdateData.medicalTreatmentRequired = medicalTreatmentRequiredStr;

    // Map scalars
    Object.entries(scalarMappings).forEach(([key, mapper]) => {
      const mapped = mapper((autoBody as any)[key]);
      if (mapped !== undefined) autoUpdateData[key] = mapped;
    });

    const [updatedClaim] = await prisma.$transaction([
      prisma.claim.update({
        where: { id: existing.id },
        data: {
          ...(Object.keys(claimUpdateData).length > 0 ? claimUpdateData : {}),
          updatedAt: new Date(),
        }
      }),
      // Conditionally update/create autoClaimData
      ...(hasAutoInput
        ? existing.autoClaimData
          ? [prisma.autoClaimData.update({
              where: { claimId: existing.id },
              data: {
                ...(Object.keys(autoUpdateData).length > 0 ? autoUpdateData : {}),
                updatedAt: new Date()
              }
            })]
          : [prisma.autoClaimData.create({
              data: {
                claimId: existing.id,
                insuredFullName: autoBody.insuredFullName || existing.customerId, // fallback to ensure required field, will be updated next fetch
                phoneNumber: autoBody.phoneNumber || '',
                policeContacted: toBoolString(autoBody.policeContacted) ?? 'false',
                injuriesOccurred: toBoolString(autoBody.injuriesOccurred) ?? 'false',
                medicalTreatmentRequired: toBoolString(autoBody.medicalTreatmentRequired) ?? 'false',
                totalPhotosUploaded: typeof autoBody.totalPhotosUploaded === 'number' ? autoBody.totalPhotosUploaded : 0,
                ...(Object.keys(autoUpdateData).length > 0 ? autoUpdateData : {})
              }
            })]
        : [])
    ]);

    // Re-fetch formatted claim (reuse GET formatting)
    const refreshed = await prisma.claim.findUnique({
      where: { id: updatedClaim.id },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
            email: true
          }
        },
        assignedAdmin: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        autoClaimData: true,
        documents: { select: { id: true, claimId: true, fileName: true, fileType: true, fileSize: true, uploadedBy: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
        claimNotes: {
          include: { author: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' }
        },
        statusHistory: { orderBy: { changedAt: 'desc' } }
      }
    });

    if (!refreshed) {
      return NextResponse.json({ success: true, message: 'Claim updated' });
    }

    const formattedClaim = {
      id: refreshed.id,
      claimNumber: refreshed.claimNumber,
      type: refreshed.type,
      status: refreshed.status,
      description: refreshed.description,
      estimatedAmount: refreshed.estimatedAmount,
      approvedAmount: refreshed.approvedAmount,
      incidentDate: refreshed.incidentDate ? refreshed.incidentDate.toISOString() : null,
      incidentTime: refreshed.incidentTime,
      createdAt: refreshed.createdAt.toISOString(),
      updatedAt: refreshed.updatedAt.toISOString(),
      approvedAt: refreshed.approvedAt?.toISOString(),
      rejectedAt: refreshed.rejectedAt?.toISOString(),
      completedAt: refreshed.completedAt?.toISOString(),
      customer: refreshed.customer,
      assignedAdmin: refreshed.assignedAdmin,
      autoClaimData: refreshed.autoClaimData
        ? {
            ...refreshed.autoClaimData,
            birthDate: refreshed.autoClaimData.birthDate?.toISOString(),
            createdAt: refreshed.autoClaimData.createdAt.toISOString(),
            updatedAt: refreshed.autoClaimData.updatedAt.toISOString()
          }
        : null,
      documents: refreshed.documents.map((doc: any) => ({
        ...doc,
        filePath: `/api/documents/${doc.claimId}/${doc.id}`,
        createdAt: doc.createdAt.toISOString()
      })),
      claimNotes: refreshed.claimNotes.map((note: any) => ({
        ...note,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString()
      })),
      statusHistory: refreshed.statusHistory.map((history: any) => ({
        ...history,
        changedAt: history.changedAt.toISOString()
      }))
    };

    return NextResponse.json({ success: true, claim: formattedClaim });
  } catch (error) {
    console.error('Error updating claim details:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}