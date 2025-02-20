import { router, authProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '../prisma';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import yauzl from 'yauzl-promise';
import { createWriteStream } from 'fs';
import { pluginInfoSchema, installPluginSchema } from '../types';
import { pluginSchema } from '@/lib/prismaZodType';
import { cache } from '@/lib/cache';

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache duration

export const pluginRouter = router({
  getAllPlugins: authProcedure
    .output(z.array(pluginInfoSchema))
    .query(async () => {
      return cache.wrap('plugin-list', async () => {
        try {
          const response = await axios.get('https://raw.githubusercontent.com/blinko-space/blinko-plugin-marketplace/main/index.json');
          return response.data;
        } catch (error) {
          console.error('Failed to fetch plugin list:', error);
          return [];
        }
      }, {
        ttl: CACHE_DURATION
      });
    }),

  saveDevPlugin: authProcedure
    .input(z.object({
      code: z.string(),
      fileName: z.string(),
      metadata: z.any()
    }))
    .output(z.any())
    .mutation(async function ({ input }) {
      const devPluginDir = path.join(process.cwd(), 'public', 'plugins', 'dev');
      try {
        await fs.rm(devPluginDir, { recursive: true, force: true });
      } catch (error) { }
      try {
        await fs.mkdir(devPluginDir, { recursive: true });
        await fs.writeFile(
          path.join(devPluginDir, input.fileName),
          input.code
        );
        return { success: true };
      } catch (error) {
        console.error('Save dev plugin error:', error);
        throw error;
      }
    }),

  installPlugin: authProcedure
    .input(installPluginSchema)
    .mutation(async ({ input }) => {
      const pluginDir = path.join(process.cwd(), 'public', 'plugins', input.name);
      const tempZipPath = path.join(pluginDir, 'release.zip');

      try {
        // Check if plugin already exists
        const existingPlugin = await prisma.plugin.findFirst({
          where: {
            metadata: {
              path: ['name'],
              equals: input.name
            }
          }
        });

        // If plugin exists and version is different, clean up old version
        if (existingPlugin) {
          const metadata = existingPlugin.metadata as { version: string };
          if (metadata.version !== input.version) {
            await fs.rm(pluginDir, { recursive: true, force: true });
          } else {
            throw new Error(`Plugin v${metadata.version} is already installed`);
          }
        }

        // Create plugin directory and download files
        await fs.mkdir(pluginDir, { recursive: true });
        const releaseUrl = `${input.url}/releases/download/v${input.version}/release.zip`;
        const response = await axios.get(releaseUrl, { responseType: 'arraybuffer' });
        await fs.writeFile(tempZipPath, response.data);

        // Extract zip file
        const zipFile = await yauzl.open(tempZipPath);
        for await (const entry of zipFile) {
          if (entry.filename.endsWith('/')) {
            await fs.mkdir(path.join(pluginDir, entry.filename), { recursive: true });
            continue;
          }

          const targetPath = path.join(pluginDir, entry.filename);
          await fs.mkdir(path.dirname(targetPath), { recursive: true });

          const readStream = await entry.openReadStream();
          const writeStream = createWriteStream(targetPath);

          await new Promise((resolve, reject) => {
            readStream
              .pipe(writeStream)
              .on('finish', resolve)
              .on('error', reject);
          });
        }

        await zipFile.close();
        await fs.unlink(tempZipPath);

        // Save to database with increased timeout
        return await prisma.$transaction(async (tx) => {
          if (existingPlugin) {
            // Update existing plugin
            const plugin = await tx.plugin.update({
              where: { id: existingPlugin.id },
              data: {
                metadata: {
                  name: input.name,
                  version: input.version,
                  author: input.author,
                  minAppVersion: input.minAppVersion,
                  displayName: input.displayName,
                  description: input.description
                },
                path: `/plugins/${input.name}/index.js`,
              }
            });
            return plugin;
          } else {
            // Create new plugin
            const plugin = await tx.plugin.create({
              data: {
                metadata: {
                  name: input.name,
                  version: input.version,
                  author: input.author,
                  minAppVersion: input.minAppVersion,
                  displayName: input.displayName,
                  description: input.description
                },
                path: `/plugins/${input.name}/index.js`,
                isUse: true,
                isDev: false,
              }
            });
            return plugin;
          }
        }, {
          timeout: 300000 // 300 seconds timeout
        });
      } catch (error) {
        // Clean up on error
        try {
          await fs.rm(pluginDir, { recursive: true, force: true });
        } catch (cleanupError) {
          console.error('Cleanup error:', cleanupError);
        }
        console.error('Install plugin error:', error);
        throw error;
      }
    }),

  getInstalledPlugins: authProcedure
    .output(z.array(pluginSchema))
    .query(async () => {
      const plugins = await prisma.plugin.findMany();
      return plugins;
    }),

  uninstallPlugin: authProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/v1/plugin/uninstall',
        summary: 'Uninstall a plugin',
        protect: true,
        tags: ['Plugin']
      }
    })
    .input(z.object({
      id: z.number()
    }))
    .mutation(async ({ input }) => {
      try {
        const plugin = await prisma.plugin.findUnique({
          where: { id: input.id }
        });

        if (!plugin) {
          throw new Error('Plugin not found');
        }

        const metadata = plugin.metadata as { name: string };
        const pluginDir = path.join(process.cwd(), 'public', 'plugins', metadata.name);

        // Delete plugin files
        await fs.rm(pluginDir, { recursive: true, force: true });

        // Delete from database
        await prisma.plugin.delete({
          where: { id: input.id }
        });

        return { success: true };
      } catch (error) {
        console.error('Uninstall plugin error:', error);
        throw error;
      }
    }),
});
