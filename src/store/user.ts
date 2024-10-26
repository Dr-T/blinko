import { User } from 'next-auth';
import { useSession } from 'next-auth/react';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { RootStore } from './root';
import { Store } from './standard/base';
import { eventBus } from '@/lib/event';

export class UserStore implements User, Store {
  sid = 'user';
  autoObservable = true;

  id: string = '';
  name?: string = '';
  nickname?: string = '';
  image?: string = '';
  token: string = '';

  wait() {
    return new Promise<UserStore>((res, rej) => {
      if (this.id && this.token) {
        res(this);
      }

      //@ts-ignore
      this.event.once('user:ready', (user) => {
        res(this);
      });
    });
  }

  static wait() {
    return RootStore.Get(UserStore).wait();
  }

  get isLogin() {
    return !!this.token;
  }

  setData(args: Partial<UserStore>) {
    Object.assign(this, args);
  }

  ready(args: Partial<UserStore>) {
    this.setData(args);
  }

  use() {
    const { data: session } = useSession();
    const router = useRouter()
    useEffect(() => {
      const userStore = RootStore.Get(UserStore);
      if (!userStore.isLogin && session) {
        console.log(session.user)
        //@ts-ignore
        userStore.ready({ ...session.user, token: session.token });
      }
    }, [session]);
    useEffect(() => {
      eventBus.on('user:signout', () => {
        if (router.pathname == '/signup' || router.pathname == '/api-doc') {
          return
        }
        router.push('/signin')
      })
    }, []);
  }
}