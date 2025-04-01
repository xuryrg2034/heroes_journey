using Entities.Components;
using Cysharp.Threading.Tasks;
using DG.Tweening;
using Interfaces;
using Grid;
using UnityEngine;

namespace Entities
{
    public abstract class BaseEntity : MonoBehaviour, IBaseEntity
    {
        public Vector3Int GridPosition { get; private set; }
        
        public Health Health { get; private set; }

        public void Init<T>(T config) where T : IBaseEntityConfig
        {
            Health = new Health(config.MaxHealth, transform);
        }
        
        public int CurrentHealth => Health.Value;

        public UniTask Move(Vector3Int gridPosition, float duration = 0.3f)
        {
            GridPosition = gridPosition;
            
            return transform.DOMove(GridService.GridPositionToTileCenter(gridPosition), duration).ToUniTask();
        }

        public virtual void Dispose()
        {
            Health.OnDie.RemoveAllListeners();
        }
    }
    
    public enum EntitySelectionType
    {
        Red,
        Green,
        Blue,
        Neutral,
    }
}