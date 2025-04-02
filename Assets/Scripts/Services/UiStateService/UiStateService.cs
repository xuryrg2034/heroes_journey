using System.Collections.Generic;

namespace Services
{
    public class UiStateService
    {
        readonly List<IUiStateListener> _listeners = new();

        public void Register(IUiStateListener listener) => _listeners.Add(listener);
        
        public void Unregister(IUiStateListener listener) => _listeners.Remove(listener);
        
        public UiGameState CurrentState { get; private set; }

        public UiStateService()
        {
            CurrentState = UiGameState.Idle;
        }

        public void SetState(UiGameState newState)
        {
            CurrentState = newState;

            foreach (var listener in _listeners)
                listener.OnUiStateChanged(newState);
        }
    }
}
