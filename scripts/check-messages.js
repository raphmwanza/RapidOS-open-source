const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    // 1. Get the most recent conversation
    const conversation = await prisma.conversation.findFirst({
        orderBy: { updatedAt: 'desc' },
        include: {
            messages: {
                orderBy: { createdAt: 'desc' },
                take: 5
            },
            customer: true
        }
    });

    if (!conversation) {
        console.log("No conversations found.");
        return;
    }

    console.log(`Processing Conversation: ${conversation.id}`);
    console.log(`Customer: ${conversation.customer.phoneNumber}`);
    console.log(`Updated At: ${conversation.updatedAt}`);
    
    console.log("\nLast 5 Messages:");
    conversation.messages.reverse().forEach(msg => {
        console.log(`[${msg.role}] ${msg.content}`);
        if (msg.metadata) {
            console.log(`Metadata: ${JSON.stringify(msg.metadata)}`);
        }
    });

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();