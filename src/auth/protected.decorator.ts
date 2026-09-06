import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Re-arms the guard for a single route inside a controller marked @Public().
 * The guard reads handler metadata before class metadata, so this wins.
 */
export const Protected = () => SetMetadata(IS_PUBLIC_KEY, false);
