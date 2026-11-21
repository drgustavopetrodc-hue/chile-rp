import { db } from "@rp-chile/db";
import DiscordProvider from "next-auth/providers/discord";
import type { NextAuthOptions } from "next-auth";

export const authOptions: NextAuthOptions = {
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID ?? "",
      clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          scope: "identify",
        },
      },
    }),
  ],
  secret: process.env.SESSION_SECRET ?? process.env.NEXTAUTH_SECRET,
  useSecureCookies: process.env.NODE_ENV === "production",
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60,
  },
  pages: {
    error: "/",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "discord") return false;

      const discordId = account.providerAccountId;
      const username = user.name?.trim();
      if (
        !/^\d{17,20}$/.test(discordId) ||
        !username ||
        username.length > 100 ||
        (user.image !== null && user.image !== undefined && user.image.length > 2048)
      ) {
        throw new Error("Discord devolvió un perfil incompleto.");
      }

      await db.usuario.upsert({
        where: { discordId },
        update: {
          username,
          avatar: user.image ?? null,
        },
        create: {
          discordId,
          username,
          avatar: user.image ?? null,
        },
      });

      return true;
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
};
