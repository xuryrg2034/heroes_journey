using System;
using System.Collections.Generic;
using UnityEngine.Events;

namespace Services.Turn
{
    public abstract class TurnPhase
    {
        protected readonly Queue<Action> _phases = new();
        
        public readonly UnityEvent<TurnState> OnChangeState = new();

        public TurnState State { get; private set; } = TurnState.Waiting;

        public abstract void Prepare();

        public virtual void StartPhase()
        {
            State = TurnState.Processing;
            _processNextPhase();
        }

        protected virtual void _preparePhase()
        {
            State = TurnState.Preparation;
            OnChangeState.Invoke(State);
        }
        
        protected void _processNextPhase()
        {
            if (_phases.Count == 0)
            {
                State = TurnState.Completed;
                OnChangeState.Invoke(State);
                return;
            }

            var nextPhase = _phases.Dequeue();
            nextPhase?.Invoke();
        }
    }

    public enum TurnState
    {
        Waiting,
        Preparation,
        Processing,
        Completed
    }
}