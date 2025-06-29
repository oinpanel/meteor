import SerializerFactory from './../../_internals/serializer';
import localforage from 'localforage';
import type { UnwrapRef, WatchStopHandle, Ref } from 'vue';
import { reactive, watch, onBeforeUnmount, ref } from 'vue';
import { handle, send } from '../../channel';

const { serialize, deserialize } = SerializerFactory({
  handle: handle,
  send: send,
});

async function setItem<INITIAL_VALUE>({
  key,
  newValue,
  persistentSharedValueStore,
  persistentSharedValueStoreBroadcast,
}: {
  key: string,
  newValue: INITIAL_VALUE,
  persistentSharedValueStore: LocalForage,
  persistentSharedValueStoreBroadcast: BroadcastChannel,
}): Promise<void>
{
  const serializedValue = serialize(newValue) as UnwrapRef<INITIAL_VALUE>;
  await persistentSharedValueStore.setItem(key, serializedValue);

  persistentSharedValueStoreBroadcast.postMessage({
    type: 'store-change',
    key: key,
  });
}

function createValueWatcher<INITIAL_VALUE>({
  key,
  sharedValue,
  persistentSharedValueStore,
  persistentSharedValueStoreBroadcast,
  getPendingValue,
}: {
  key: string,
  sharedValue: {
    value: UnwrapRef<INITIAL_VALUE>,
  },
  persistentSharedValueStore: LocalForage,
  persistentSharedValueStoreBroadcast: BroadcastChannel,
  getPendingValue: () => boolean,
}): WatchStopHandle {
  return watch(
    () => sharedValue.value,
    async (newValue) => {
      if (getPendingValue()) {
        return;
      }

      await setItem<UnwrapRef<INITIAL_VALUE>>({
        key,
        newValue,
        persistentSharedValueStore,
        persistentSharedValueStoreBroadcast,
      });
    },
    { deep: true }
  );
}

function setRemoteValue<INITIAL_VALUE>({
  setPendingValue,
  removeWatcher,
  setWatcher,
  store,
  key,
  sharedValue,
}: {
  setPendingValue: (newValue: boolean) => void,
  removeWatcher: () => void,
  setWatcher: () => void,
  store: LocalForage,
  key: string,
  sharedValue: {
    value: UnwrapRef<INITIAL_VALUE>,
  },
}): Promise<void> {
  setPendingValue(true);
  removeWatcher();

  return store.getItem<INITIAL_VALUE>(key)
    .then((value) => {
      if (value === null) {
        return;
      }

      const deserializedValue = deserialize(value, new MessageEvent('message')) as UnwrapRef<INITIAL_VALUE>;

      sharedValue.value = deserializedValue;
    })
    .finally(() => {
      setPendingValue(false);
      setWatcher();
    });
}

/**
 * @internal
 * @private
 */
export function _useSharedState<INITIAL_VALUE>(key: string, initalValue: INITIAL_VALUE): {
  state: { value: UnwrapRef<INITIAL_VALUE> },
  isReady: Ref<boolean>,
  ready: Promise<void>,
} {
  const isReady = ref(false);
  let isPending = false;

  const getPendingValue = (): boolean => isPending;
  const setPendingValue = (newValue: boolean): void => {
    isPending = newValue;
  };
  const removeWatcher = (): void => {
    unwatchValue();
  };
  const setWatcher = (): void => {
    unwatchValue();

    unwatchValue = createValueWatcher<INITIAL_VALUE>({
      key,
      sharedValue,
      persistentSharedValueStore,
      persistentSharedValueStoreBroadcast,
      getPendingValue,
    });
  };

  const persistentSharedValueStore = localforage.createInstance({
    name: 'adminExtensionSDK',
    storeName: 'persistentSharedValueStore',
  });

  const persistentSharedValueStoreBroadcast = new BroadcastChannel('persistentSharedValueStore');

  const sharedValue = reactive({
    value: initalValue,
  });

  let unwatchValue = createValueWatcher<INITIAL_VALUE>({
    key,
    sharedValue,
    persistentSharedValueStore,
    persistentSharedValueStoreBroadcast,
    getPendingValue,
  });

  const eventListener = (event: MessageEvent<{
    type: string,
    key: string,
  }>): void => {
    if (event.data.type !== 'store-change') {
      return;
    }

    if (event.data.key !== key) {
      return;
    }

    void setRemoteValue({
      setPendingValue,
      removeWatcher,
      setWatcher,
      store: persistentSharedValueStore,
      key,
      sharedValue,
    });
  };

  persistentSharedValueStoreBroadcast.addEventListener('message', eventListener);

  onBeforeUnmount(() => {
    persistentSharedValueStoreBroadcast.close();
    persistentSharedValueStoreBroadcast.removeEventListener('message', eventListener);
  });

  // Get initial value from remote
  const remoteValuePromise = setRemoteValue({
    setPendingValue,
    removeWatcher,
    setWatcher,
    store: persistentSharedValueStore,
    key,
    sharedValue,
  });

  // Set inital value when remote value is not available
  const initialValuePromise = persistentSharedValueStore.getItem<INITIAL_VALUE>(key)
    .then(async (value) => {
      if (value !== null) {
        return;
      }

      await setItem<INITIAL_VALUE>({
        key,
        newValue: initalValue,
        persistentSharedValueStore,
        persistentSharedValueStoreBroadcast,
      });
    })
    // Handle error silently because the broadcast channel could be closed
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    .catch(() => {});

  const ready = Promise.all([
    remoteValuePromise,
    initialValuePromise,
  ]).then(() => {
    isReady.value = true;
  });

  return {
    state: sharedValue,
    isReady,
    ready,
  };
}

/**
 *
 * @param key - Shared state key
 * @param initalValue - Initial value
 * @returns
 */
export function useSharedState<INITIAL_VALUE>(key: string, initalValue: INITIAL_VALUE): {
  value: UnwrapRef<INITIAL_VALUE>,
} {
  return _useSharedState(key, initalValue).state;
}
