import { auth } from "@clerk/nextjs";

import prismadb from "@/lib/prismadb";
import { MAX_FREE_COUNT } from "@/constants";

export const increaseApiLimit = async () => {
  const authResult = await auth();
  const userId = authResult.userId;

  if (!userId) return;

  const userApiLimit = await prismadb.userApiLimit.findUnique({
    where: { userId }
  });

  if (userApiLimit) {
    await prismadb.userApiLimit.update({
      where: { userId },
      data: { count: userApiLimit.count + 1 }
    });
  } else {
    await prismadb.userApiLimit.create({
      data: {
        userId,
        count: 1
      }
    });
  }
};

export const checkApiLimit = async () => {
  const authResult = await auth();
  const userId = authResult.userId;

  if (!userId) return false;

  const userApiLimit = await prismadb.userApiLimit.findUnique({
    where: { userId }
  });

  if (!userApiLimit || userApiLimit.count < MAX_FREE_COUNT) {
    return true;
  } else {
    return false;
  }
};

export const getApiLimitCount = async () => {
  const authResult = await auth();
  const userId = authResult.userId;

  if (!userId) return 0;

  const userApiLimit = await prismadb.userApiLimit.findUnique({
    where: { userId }
  });

  if (!userApiLimit) return 0;

  return userApiLimit.count;
};
