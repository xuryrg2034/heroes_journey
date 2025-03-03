using System;
using Components.Entity;
using Cysharp.Threading.Tasks;
using DG.Tweening;
using Grid;
using UnityEngine;
using UnityEngine.Events;

namespace Core.Entities
{
    public abstract class Entity : MonoBehaviour
    {
        [SerializeField] private Cell cell;
        [SerializeField] private EntitySelectionType selectionType;

        [Header("Characteristics")]
        [SerializeField] private int health;
        
        public Health Health { get; private set; }

        public EntitySelectionType SelectionType => selectionType;

        public Cell Cell => cell;

        public virtual void Init()
        {
            Health = new Health(health, transform);
        }
        
        public void SetCell(Cell value)
        {
            cell = value;

            if (value != null)
            {
                transform.position = value.transform.position;   
            }
        }

        public UniTask Move(Cell targetCell, float duration = 0.3f)
        {
            cell = targetCell;
            
            return transform.DOMove(targetCell.transform.position, duration).ToUniTask();
        }

        public virtual void Dispose()
        {
            cell = null;

            Destroy(gameObject);
            Health.OnDie.RemoveAllListeners();
        }
    }

    public enum EntityType
    {
        Enemy,
        Hero,
    }
    
    public enum EntitySelectionType
    {
        Red,
        Green,
        Blue,
        Neutral,
    }
}