import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware } from '@/lib/middleware';
import { ADMIN_ROLES } from '@/lib/users/roles';
import { deleteStoredFile, knowledgeKeyFromUrl } from '@/lib/storage/fileStore';

export async function GET(request: NextRequest) {
  // Check authentication
  const authError = await authMiddleware(request, { requiredRole: [...ADMIN_ROLES] });
  if (authError) return authError;

  try {
    const { admin } = request as any;

    // Fetch settings from database using Prisma
    const settingsData = await prisma.setting.findMany({
      where: {
        companyId: admin.companyId
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Map the data to match frontend interface
    const settings = settingsData.map((setting: any) => ({
      ...setting,
      type: setting.type.toLowerCase(), // Convert back to lowercase for frontend
      value: setting.textValue || setting.documentUrl || setting.boolValue?.toString(),
    }));

    return NextResponse.json({
      settings
    });

  } catch (error) {
    console.error('Failed to fetch settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Check authentication
  const authError = await authMiddleware(request, { requiredRole: [...ADMIN_ROLES] });
  if (authError) return authError;

  try {
    const { admin } = request as any;
    const body = await request.json();

    const { name, description, type, value, documentUrl, documentContent } = body;

    // Validate required fields
    if (!name || !description || !type) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Create the setting in database using Prisma
    const settingType = type.toUpperCase(); // Convert to uppercase for Prisma enum
    const newSetting = await prisma.setting.create({
      data: {
        name,
        description,
        type: settingType as any, // Prisma enum type
        textValue: settingType === 'TEXT' ? value : undefined,
        documentUrl: settingType === 'DOCUMENT' ? documentUrl : undefined,
        documentContent: settingType === 'DOCUMENT' ? (documentContent || undefined) : undefined,
        boolValue: settingType === 'BOOLEAN' ? (value === 'true' || value === true) : undefined,
        isActive: true,
        companyId: admin.companyId,
        createdBy: admin.id,
        updatedBy: admin.id
      }
    });

    // Transform for frontend
    const setting = {
      ...newSetting,
      type: newSetting.type.toLowerCase(),
      value: newSetting.textValue || newSetting.documentUrl || newSetting.boolValue?.toString()
    };

    return NextResponse.json({
      setting,
      message: 'Setting created successfully'
    });

  } catch (error) {
    console.error('Failed to create setting:', error);
    return NextResponse.json(
      { error: 'Failed to create setting' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  // Check authentication
  const authError = await authMiddleware(request, { requiredRole: [...ADMIN_ROLES] });
  if (authError) return authError;

  try {
    const { admin } = request as any;
    const body = await request.json();

    const { id, name, description, value, documentUrl, documentContent, isActive } = body;

    // Validate required fields
    if (!id) {
      return NextResponse.json(
        { error: 'Setting ID is required' },
        { status: 400 }
      );
    }

    // Update the setting in database using Prisma
    const updatedSetting = await prisma.setting.update({
      where: {
        id,
        companyId: admin.companyId
      },
      data: {
        name,
        description,
        textValue: value,
        documentUrl,
        documentContent,
        isActive,
        updatedBy: admin.id,
        updatedAt: new Date()
      }
    });

    // Transform for frontend
    const setting = {
      ...updatedSetting,
      type: updatedSetting.type.toLowerCase(),
      value: updatedSetting.textValue || updatedSetting.documentUrl || updatedSetting.boolValue?.toString()
    };

    return NextResponse.json({
      setting,
      message: 'Setting updated successfully'
    });

  } catch (error) {
    console.error('Failed to update setting:', error);
    return NextResponse.json(
      { error: 'Failed to update setting' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  // Check authentication
  const authError = await authMiddleware(request, { requiredRole: [...ADMIN_ROLES] });
  if (authError) return authError;

  try {
    const { admin } = request as any;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Setting ID is required' },
        { status: 400 }
      );
    }

    // Delete the setting from database using Prisma
    const deleted = await prisma.setting.delete({
      where: {
        id,
        companyId: admin.companyId
      }
    });
    const storedKey = knowledgeKeyFromUrl(deleted.documentUrl);
    if (storedKey) await deleteStoredFile(storedKey, admin.companyId);

    return NextResponse.json({
      message: 'Setting deleted successfully'
    });

  } catch (error) {
    console.error('Failed to delete setting:', error);
    return NextResponse.json(
      { error: 'Failed to delete setting' },
      { status: 500 }
    );
  }
}
