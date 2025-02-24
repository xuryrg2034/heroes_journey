using System;
using System.Collections.Generic;

namespace Services.Turn
{
    public abstract class TurnPhase
    {
        protected readonly Queue<Action> _turnPhases = new();
        public event Action OnTurnCompleted;
        public static event Action OnSomeTurnCompleted;
        public static event Action OnSomeTurnStart;
        public bool IsProcessing = false;

        public abstract void StartPhase();

        protected virtual void _preparePhase()
        {
            OnSomeTurnStart?.Invoke();
        }
        
        protected void _processNextPhase()
        {
            if (_turnPhases.Count == 0)
            {
                OnSomeTurnCompleted?.Invoke();
                OnTurnCompleted?.Invoke();
                return;
            }

            var nextPhase = _turnPhases.Dequeue();
            nextPhase?.Invoke();
        }
    }
}