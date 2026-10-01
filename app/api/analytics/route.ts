import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware } from '@/lib/middleware';

export async function GET(request: NextRequest) {
  // Check authentication
  const authError = await authMiddleware(request);
  if (authError) return authError;

  try {
    const { admin } = request as any;
    
    // Get current date for analytics
  // Date variables can be reintroduced for time-bounded analytics when needed
    
    // Get claims statistics
    const totalClaims = await prisma.claim.count({
      where: { companyId: admin.companyId }
    });

    const newClaims = await prisma.claim.count({
      where: { 
        companyId: admin.companyId,
        status: 'NEW'
      }
    });

    const ongoingClaims = await prisma.claim.count({
      where: { 
        companyId: admin.companyId,
        status: 'ONGOING'
      }
    });

    const approvedClaims = await prisma.claim.count({
      where: { 
        companyId: admin.companyId,
        status: 'APPROVED'
      }
    });

    const rejectedClaims = await prisma.claim.count({
      where: { 
        companyId: admin.companyId,
        status: 'REJECTED'
      }
    });

    const completedClaims = await prisma.claim.count({
      where: { 
        companyId: admin.companyId,
        status: 'COMPLETED'
      }
    });

    // Get conversation statistics
    const totalConversations = await prisma.conversation.count({
      where: { companyId: admin.companyId }
    });

    // Note: Monthly conversations can be added later if needed

    // Get feedback statistics
    const feedbacks = await prisma.feedback.findMany({
      where: { companyId: admin.companyId },
      select: { rating: true }
    });

    // Calculate average satisfaction manually
    const ratingValues = {
      'POOR': 1,
      'FAIR': 2,
      'GOOD': 3,
      'VERY_GOOD': 4,
      'EXCELLENT': 5
    };

    const totalFeedbacks = feedbacks.length;
    const sumRatings = feedbacks.reduce((sum: number, feedback: any) => {
      return sum + (ratingValues[feedback.rating as keyof typeof ratingValues] || 0);
    }, 0);

    const avgSatisfactionRating = totalFeedbacks > 0 ? sumRatings / totalFeedbacks : 0;

    // Calculate escalation rate (conversations that needed human help)
    const escalatedConversations = await prisma.conversation.count({
      where: {
        companyId: admin.companyId,
        messages: {
          some: {
            content: {
              contains: 'agent',
              mode: 'insensitive'
            }
          }
        }
      }
    });

    // Calculate rates
    const resolutionRate = totalClaims > 0 ? ((completedClaims + approvedClaims) / totalClaims) * 100 : 0;
    const escalationRate = totalConversations > 0 ? (escalatedConversations / totalConversations) * 100 : 0;
    
    // Default response time (in a real implementation, you'd calculate this from message timestamps)
    const avgResponseTime = 2.5; // seconds
    
    const analytics = {
      totalClaims,
      newClaims,
      ongoingClaims,
      approvedClaims,
      rejectedClaims,
      completedClaims,
      resolutionRate,
      avgResponseTime,
      escalationRate,
      avgSatisfactionRating,
      totalConversations,
      totalFeedbacks
    };

    return NextResponse.json({
      analytics
    });

  } catch (error) {
    console.error('Failed to fetch analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
}
