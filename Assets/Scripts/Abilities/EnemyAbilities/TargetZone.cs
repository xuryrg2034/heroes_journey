using System;
using Core.Entities;
using Cysharp.Threading.Tasks;
using DG.Tweening;
using UnityEngine;
using UnityEngine.Serialization;

namespace Abilities.EnemyAbilities
{
    public class TargetZone : MonoBehaviour
    {
        public Entity Target { get; private set; } 
        
        private void OnTriggerEnter2D(Collider2D other)
        {
            var entity = other.GetComponent<Entity>();
            if (entity != null)
            {
                Target = entity;
                Debug.Log($"Это target: {entity.transform.position}");
            }
        }
        
        private void OnTriggerExit2D(Collider2D other)
        {
            var entity = other.GetComponent<Entity>();
            if (entity && Target == entity)
            {
                Target = null;
            }
        }
    }
}