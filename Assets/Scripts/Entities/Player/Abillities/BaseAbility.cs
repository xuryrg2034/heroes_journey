using System;
using Core;
using Cysharp.Threading.Tasks;
using UnityEngine;

namespace Entities.Player
{
    public abstract class BaseAbility : MonoBehaviour
    {
        [SerializeField] string title;
        [SerializeField] int energyCost;
        [SerializeField] int cooldown;
        [SerializeField] protected LayerMask tilemapLayer;

        protected Hero Owner;

        public AbilityStateMachine StateMachine { get; private set; }

        public LayerMask TilemapLayer => tilemapLayer;
        
        public State SelectionState { get; protected set; }
        
        public State ExecuteState { get; protected set; }

        public string Title => title;

        public virtual void Init(Hero owner, AbilityStateMachine stateMachine)
        {
            Owner = owner;
            StateMachine =  stateMachine;
        }

        public virtual UniTask Execute()
        {
            return default;
        }
    }
}