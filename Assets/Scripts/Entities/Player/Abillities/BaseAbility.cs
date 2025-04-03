using System;
using Core;
using Cysharp.Threading.Tasks;
using UnityEngine;
using UnityEngine.Events;

namespace Entities.Player
{
    public abstract class BaseAbility : MonoBehaviour
    {
        [SerializeField] string title;
        [SerializeField] Sprite icon;
        [SerializeField] int energyCost;
        [SerializeField] int cooldown;
        [SerializeField] protected LayerMask tilemapLayer;

        public LayerMask TilemapLayer => tilemapLayer;
        
        public State SelectionState { get; protected set; }
        
        public State ExecuteState { get; protected set; }

        public string Title => title;
        
        public Sprite Icon => icon;
        
        public int EnergyCost => energyCost;

        public bool IsSelected { get; private set; }
        
        public readonly UnityEvent<bool> OnSelected = new();

        public bool CanBeExecute { get; protected set; }
        
        public bool IsInProcess { get; protected set; }
        
        protected Hero Owner;

        protected AbilityStateMachine StateMachine { get; private set; }

        public virtual void Init(Hero owner, AbilityStateMachine stateMachine)
        {
            Owner = owner;
            StateMachine =  stateMachine;
        }

        public virtual UniTask Execute()
        {
            Owner.Energy.Decrease(energyCost); 
            return default;
        }

        public void SetSelect(bool value)
        {
            IsSelected = value;
            OnSelected.Invoke(IsSelected);
        }
    }
}