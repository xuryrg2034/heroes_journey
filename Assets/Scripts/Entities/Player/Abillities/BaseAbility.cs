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

        public LayerMask TilemapLayer => tilemapLayer;
        
        public State InitState { get; protected set; }

        public string Title => title;

        public void Init(Hero owner)
        {
            Owner = owner;
        }

        public virtual UniTask Execute()
        {
            return default;
        }
    }
}