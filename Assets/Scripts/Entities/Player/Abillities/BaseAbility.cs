using System;
using Core;
using Cysharp.Threading.Tasks;
using UnityEngine;

namespace Entities.Player
{
    public abstract class BaseAbility : MonoBehaviour
    {
        [SerializeField] private int damage;
        [SerializeField] private string title;
        [SerializeField] private int energyCost;
        [SerializeField] private int cooldown;
        [SerializeField] protected LayerMask tilemapLayer;

        protected Hero _owner;

        public LayerMask TilemapLayer => tilemapLayer;

        public int Damage => damage; 
        
        public State InitState { get; protected set; }

        public string Title => title;

        public virtual void Init(Hero owner)
        {
            _owner = owner;
        }

        public virtual UniTask Execute()
        {
            return default;
        }
    }
}