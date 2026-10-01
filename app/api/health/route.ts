import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Simple health check - could be extended to check database connectivity
    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV,
      version: '1.0.0',
    };

    return NextResponse.json(healthData, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { 
        status: 'unhealthy', 
        error: 'Health check failed',
        timestamp: new Date().toISOString(),
      }, 
      { status: 500 }
    );
  }
}
